/// <reference lib="webworker" />

import h5wasm from "h5wasm";
import type {
  Annotation,
  EmbeddedClientData,
  EmbeddedLabel,
  EmbeddedSequenceTaxonomy,
  EmbeddedVideo,
  H5Summary,
  Sequence,
} from "./types";

type H5Dataset = {
  shape: number[];
  value: unknown;
  metadata: { compound_type?: { members: Array<{ name: string }> } };
};

type H5Handle = {
  close(): void;
  attrs: Record<string, { value: unknown }>;
  get(path: string): unknown;
};

function plain(value: unknown): string | number | boolean | string[] {
  if (typeof value === "bigint") return Number(value);
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>).map(String);
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function rows(dataset: H5Dataset): Array<Record<string, unknown>> {
  const names = dataset.metadata.compound_type?.members.map((item) => item.name);
  const values = dataset.value;
  if (!names || !Array.isArray(values)) throw new Error("A required compound dataset is invalid");
  return values.map((row) => {
    if (!Array.isArray(row) || row.length !== names.length) throw new Error("A compound row is invalid");
    return Object.fromEntries(names.map((name, index) => [name, row[index]]));
  });
}

function integer(value: unknown, label: string) {
  const result = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} is not a safe integer`);
  return result;
}

function textValue(value: unknown, label: string) {
  if (typeof value === "string") return value.replace(/\0+$/u, "");
  if (value instanceof Uint8Array) return new TextDecoder().decode(value).replace(/\0+$/u, "");
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return new TextDecoder().decode(Uint8Array.from(value)).replace(/\0+$/u, "");
  }
  if (value === undefined || value === null) throw new Error(`${label} is missing`);
  return String(value).replace(/\0+$/u, "");
}

function embeddedClientData(
  handle: H5Handle,
  attrs: Record<string, string | number | boolean | string[]>,
  fileSize: number,
): EmbeddedClientData | undefined {
  if (attrs.schema_version !== "cw12eu_client_hdf5_v1") return undefined;
  if (attrs.contract_version !== "1.0.0" || attrs.embedded_dataset_schema_version !== "3.1.0") {
    throw new Error("Unsupported CW12EU client HDF5 contract");
  }
  const videos = rows(handle.get("media/index") as H5Dataset).map<EmbeddedVideo>((row) => ({
    sequence_index: integer(row.sequence_index, "media sequence_index"),
    recording_id: textValue(row.recording_id, "media recording_id"),
    dataset_path: textValue(row.dataset_path, "media dataset_path"),
    content_type: textValue(row.content_type, "media content_type"),
    container: textValue(row.container, "media container"),
    byte_length: integer(row.byte_length, "media byte_length"),
    file_offset: integer(row.file_offset, "media file_offset"),
    sha256: textValue(row.sha256, "media sha256"),
    media_duration_ns: integer(row.media_duration_ns, "media duration"),
    sample_zero_video_media_time_ns: integer(
      row.sample_zero_video_media_time_ns,
      "sample-zero video media time",
    ),
  }));
  const sequenceIndexes = new Set<number>();
  for (const video of videos) {
    if (!/^[0-9a-f]{64}$/iu.test(video.sha256)) {
      throw new Error("Embedded video SHA-256 is invalid");
    }
    if (video.byte_length <= 0 || video.file_offset < 0 || video.file_offset + video.byte_length > fileSize) {
      throw new Error("Embedded video byte range is outside the HDF5 file");
    }
    if (sequenceIndexes.has(video.sequence_index)) throw new Error("Embedded video sequence index is duplicated");
    sequenceIndexes.add(video.sequence_index);
  }
  const labels = rows(handle.get("labels/catalog") as H5Dataset).map<EmbeddedLabel>((row) => ({
    taxonomy_id: textValue(row.taxonomy_id, "taxonomy_id"),
    taxonomy_version: textValue(row.taxonomy_version, "taxonomy_version"),
    code: textValue(row.code, "label code"),
    name: textValue(row.name, "label name"),
    is_fall: Boolean(row.is_fall),
    active: Boolean(row.active),
  }));
  const sequenceTaxonomies = rows(
    handle.get("labels/sequence_versions") as H5Dataset,
  ).map<EmbeddedSequenceTaxonomy>((row) => ({
    sequence_index: integer(row.sequence_index, "label sequence_index"),
    taxonomy_id: textValue(row.taxonomy_id, "taxonomy_id"),
    taxonomy_version: textValue(row.taxonomy_version, "taxonomy_version"),
  }));
  return {
    schema_version: "cw12eu_client_hdf5_v1",
    contract_version: "1.0.0",
    videos,
    labels,
    sequenceTaxonomies,
  };
}

self.onmessage = async (event: MessageEvent<File>) => {
  const file = event.data;
  const mount = `/work-${crypto.randomUUID()}`;
  let handle: H5Handle | undefined;
  try {
    const { FS } = await h5wasm.ready;
    FS.mkdir(mount);
    FS.mount(FS.filesystems.WORKERFS, { files: [file] }, mount);
    handle = new h5wasm.File(`${mount}/${file.name}`, "r") as unknown as typeof handle;
    if (!handle) throw new Error("Unable to open HDF5 file");
    const samplesDataset = handle.get("samples") as H5Dataset;
    const sequencesDataset = handle.get("sequences") as H5Dataset;
    const annotationsDataset = handle.get("annotations") as H5Dataset;
    if (!samplesDataset || !sequencesDataset || !annotationsDataset) {
      throw new Error("Required HDF5 datasets are missing");
    }
    if (samplesDataset.shape.length !== 2 || samplesDataset.shape[1] !== 6) {
      throw new Error("/samples must have shape [N, 6]");
    }
    const samples = samplesDataset.value;
    if (!(samples instanceof Float32Array) || samples.length !== samplesDataset.shape[0] * 6) {
      throw new Error("/samples must contain float32 SI values");
    }
    const attrs = Object.fromEntries(
      Object.entries(handle.attrs).map(([name, attribute]) => [name, plain(attribute.value)]),
    );
    const strictDataset = attrs.imu_schema_version === "3.1.0";
    const clientDataset = attrs.schema_version === "cw12eu_client_hdf5_v1";
    if ((!strictDataset && !clientDataset) || attrs.sampling_rate_hz !== 25) {
      throw new Error("Only CW12EU-compatible HDF5 schema 3.1.0 at 25 Hz is supported");
    }
    const sequences: Sequence[] = rows(sequencesDataset).map((row) => ({
      sample_start: integer(row.sample_start, "sample_start"),
      sample_stop: integer(row.sample_stop, "sample_stop"),
      source_file: String(row.source_file),
      participant_id: String(row.participant_id),
      recording_id: String(row.recording_id),
      body_location: String(row.body_location),
      activity_code: String(row.activity_code),
      is_fall: Boolean(row.is_fall),
      supervision_kind: String(row.supervision_kind),
      source_sampling_rate_hz: Number(row.source_sampling_rate_hz),
    }));
    const annotations: Annotation[] = rows(annotationsDataset).map((row) => ({
      sequence_index: integer(row.sequence_index, "sequence_index"),
      kind: String(row.kind),
      start_sample: integer(row.start_sample, "start_sample"),
      stop_sample: integer(row.stop_sample, "stop_sample"),
      code: String(row.code),
    }));
    const response: H5Summary = {
      attrs,
      sampleCount: samplesDataset.shape[0],
      samples,
      sequences,
      annotations,
      embedded: embeddedClientData(handle, attrs, file.size),
    };
    self.postMessage({ ok: true, result: response }, { transfer: [samples.buffer] });
    handle.close();
    handle = undefined;
    FS.unmount(mount);
    FS.rmdir(mount);
  } catch (error) {
    try { handle?.close(); } catch { /* best effort */ }
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

export {};
