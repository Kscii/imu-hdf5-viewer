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
  TimingPoint,
} from "./types";

const REQUIRED_COLUMNS = [
  "acceleration_x_mps2",
  "acceleration_y_mps2",
  "acceleration_z_mps2",
  "angular_velocity_x_rad_s",
  "angular_velocity_y_rad_s",
  "angular_velocity_z_rad_s",
];

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
  if (ArrayBuffer.isView(value)) {
    return Array.from(value as unknown as ArrayLike<number>).map(String);
  }
  if (Array.isArray(value)) return value.map(String);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}

function textValue(value: unknown, label: string) {
  if (typeof value === "string") return value.replace(/\0+$/u, "");
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value).replace(/\0+$/u, "");
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return new TextDecoder().decode(Uint8Array.from(value)).replace(/\0+$/u, "");
  }
  if (value === undefined || value === null) throw new Error(`${label} is missing`);
  return String(value).replace(/\0+$/u, "");
}

function integer(value: unknown, label: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} is not a safe integer`);
  return result;
}

function rows(
  dataset: H5Dataset,
  expected: string[],
  label: string,
): Array<Record<string, unknown>> {
  const names = dataset.metadata.compound_type?.members.map((item) => item.name);
  if (!names || JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`${label} fields or order are invalid`);
  }
  const values = dataset.value;
  if (!Array.isArray(values)) throw new Error(`${label} is not a compound dataset`);
  return values.map((row) => {
    if (!Array.isArray(row) || row.length !== names.length) {
      throw new Error(`${label} contains an invalid row`);
    }
    return Object.fromEntries(names.map((name, index) => [name, row[index]]));
  });
}

function safeGet(handle: H5Handle, path: string): unknown {
  try {
    return handle.get(path);
  } catch {
    return undefined;
  }
}

function parseColumns(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function timingRows(dataset: H5Dataset, label: string): TimingPoint[] {
  if (
    dataset.shape.length !== 2 ||
    dataset.shape[1] !== 2 ||
    dataset.shape[0] < 2 ||
    !ArrayBuffer.isView(dataset.value)
  ) {
    throw new Error(`${label} must be int64 [F, 2]`);
  }
  const values = Array.from(
    dataset.value as unknown as ArrayLike<number | bigint>,
    (value) => integer(value, label),
  );
  if (values.length !== dataset.shape[0] * 2) {
    throw new Error(`${label} shape does not match its values`);
  }
  const result: TimingPoint[] = [];
  for (let index = 0; index < values.length; index += 2) {
    const point = {
      recording_time_ns: values[index],
      media_time_ns: values[index + 1],
    };
    const previous = result.at(-1);
    if (
      previous &&
      (point.recording_time_ns <= previous.recording_time_ns ||
        point.media_time_ns <= previous.media_time_ns)
    ) {
      throw new Error(`${label} is not strictly monotonic`);
    }
    result.push(point);
  }
  return result;
}

function embeddedClientData(
  handle: H5Handle,
  attrs: Record<string, string | number | boolean | string[]>,
  fileSize: number,
  sequences: Sequence[],
  annotations: Annotation[],
): EmbeddedClientData {
  if (attrs.client_delivery_contract_version !== "1.0.0") {
    throw new Error("Unsupported client delivery contract");
  }
  const rawIndex = safeGet(handle, "media/index") as H5Dataset | undefined;
  const rawLabels = safeGet(handle, "labels/catalog") as H5Dataset | undefined;
  const rawVersions = safeGet(
    handle,
    "labels/sequence_versions",
  ) as H5Dataset | undefined;
  if (!rawIndex || !rawLabels || !rawVersions) {
    throw new Error("Client delivery media or label tables are missing");
  }
  const indexRows = rows(
    rawIndex,
    [
      "sequence_index",
      "byte_length",
      "file_offset",
      "sha256",
      "content_type",
      "container",
      "media_duration_ns",
      "sample_zero_recording_time_ns",
      "sample_zero_media_time_ns",
    ],
    "/media/index",
  );
  if (indexRows.length !== sequences.length) {
    throw new Error("/media/index must cover every sequence exactly once");
  }
  const videos = indexRows.map<EmbeddedVideo>((row, expectedIndex) => {
    const sequenceIndex = integer(row.sequence_index, "media sequence_index");
    if (sequenceIndex !== expectedIndex) {
      throw new Error("/media/index is not ordered by sequence_index");
    }
    const timingDataset = safeGet(
      handle,
      `media/timing/${sequenceIndex}`,
    ) as H5Dataset | undefined;
    const videoDataset = safeGet(
      handle,
      `media/videos/${sequenceIndex}`,
    ) as H5Dataset | undefined;
    if (!timingDataset || !videoDataset) {
      throw new Error("A client-delivery media dataset is missing");
    }
    const byteLength = integer(row.byte_length, "media byte_length");
    const fileOffset = integer(row.file_offset, "media file_offset");
    const sha256 = textValue(row.sha256, "media sha256");
    if (
      !/^[0-9a-f]{64}$/u.test(sha256) ||
      textValue(row.content_type, "media content type") !== "video/mp4" ||
      textValue(row.container, "media container") !== "mp4" ||
      byteLength <= 0 ||
      fileOffset < 0 ||
      fileOffset + byteLength > fileSize ||
      videoDataset.shape.length !== 1 ||
      videoDataset.shape[0] !== byteLength
    ) {
      throw new Error("Embedded video descriptor or byte range is invalid");
    }
    const timing = timingRows(timingDataset, `/media/timing/${sequenceIndex}`);
    const sequence = sequences[sequenceIndex];
    const sampleZeroRecording = integer(
      row.sample_zero_recording_time_ns,
      "sample-zero recording time",
    );
    const sampleZeroMedia = integer(
      row.sample_zero_media_time_ns,
      "sample-zero media time",
    );
    const sequenceStop =
      sampleZeroRecording +
      (sequence.sample_stop - sequence.sample_start - 1) * 40_000_000;
    if (
      timing[0].recording_time_ns !== sampleZeroRecording ||
      timing[0].media_time_ns !== sampleZeroMedia ||
      timing.at(-1)?.recording_time_ns !== sequenceStop ||
      timing.at(-1)!.media_time_ns >
        integer(row.media_duration_ns, "media duration")
    ) {
      throw new Error("Embedded timing does not cover its sequence");
    }
    return {
      sequence_index: sequenceIndex,
      content_type: "video/mp4",
      container: "mp4",
      byte_length: byteLength,
      file_offset: fileOffset,
      sha256,
      media_duration_ns: integer(row.media_duration_ns, "media duration"),
      sample_zero_recording_time_ns: sampleZeroRecording,
      sample_zero_media_time_ns: sampleZeroMedia,
      timing,
    };
  });
  const ranges = videos
    .map((item) => [item.file_offset, item.file_offset + item.byte_length])
    .sort((left, right) => left[0] - right[0]);
  if (ranges.some((range, index) => index > 0 && ranges[index - 1][1] > range[0])) {
    throw new Error("Embedded video physical ranges overlap");
  }

  const labels = rows(
    rawLabels,
    [
      "taxonomy_id",
      "taxonomy_version",
      "code",
      "name",
      "is_fall",
      "active",
    ],
    "/labels/catalog",
  ).map<EmbeddedLabel>((row) => ({
    taxonomy_id: textValue(row.taxonomy_id, "taxonomy_id"),
    taxonomy_version: textValue(row.taxonomy_version, "taxonomy_version"),
    code: textValue(row.code, "label code"),
    name: textValue(row.name, "label name"),
    is_fall: Boolean(row.is_fall),
    active: Boolean(row.active),
  }));
  const sequenceTaxonomies = rows(
    rawVersions,
    ["sequence_index", "taxonomy_id", "taxonomy_version"],
    "/labels/sequence_versions",
  ).map<EmbeddedSequenceTaxonomy>((row, expectedIndex) => {
    const sequenceIndex = integer(row.sequence_index, "label sequence_index");
    if (sequenceIndex !== expectedIndex) {
      throw new Error("/labels/sequence_versions is not ordered by sequence_index");
    }
    return {
      sequence_index: sequenceIndex,
      taxonomy_id: textValue(row.taxonomy_id, "taxonomy_id"),
      taxonomy_version: textValue(row.taxonomy_version, "taxonomy_version"),
    };
  });
  if (sequenceTaxonomies.length !== sequences.length) {
    throw new Error("Every sequence must have one frozen taxonomy version");
  }
  const catalog = new Set(
    labels.map(
      (item) =>
        `${item.taxonomy_id}\0${item.taxonomy_version}\0${item.code}`,
    ),
  );
  for (const annotation of annotations) {
    if (annotation.kind === "exclude") continue;
    const version = sequenceTaxonomies[annotation.sequence_index ?? -1];
    if (
      !version ||
      !catalog.has(
        `${version.taxonomy_id}\0${version.taxonomy_version}\0${annotation.code}`,
      )
    ) {
      throw new Error("An annotation code is missing from its frozen taxonomy");
    }
  }
  return {
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
    handle = new h5wasm.File(
      `${mount}/${file.name}`,
      "r",
    ) as unknown as typeof handle;
    if (!handle) throw new Error("Unable to open HDF5 file");

    const attrs = Object.fromEntries(
      Object.entries(handle.attrs).map(([name, attribute]) => [
        name,
        plain(attribute.value),
      ]),
    );
    const profile = attrs.artifact_profile;
    if (
      attrs.imu_schema_version !== "3.2.0" ||
      (profile !== "training_dataset" && profile !== "client_delivery") ||
      attrs.sampling_rate_hz !== 25 ||
      attrs.axis_frame !== "sensor_local" ||
      attrs.hdf5_compatibility !== "1.14" ||
      JSON.stringify(parseColumns(attrs.feature_columns)) !==
        JSON.stringify(REQUIRED_COLUMNS)
    ) {
      throw new Error(
        "Only HDF5 3.2 training_dataset or client_delivery at 25 Hz is supported",
      );
    }

    const samplesDataset = safeGet(handle, "samples") as H5Dataset | undefined;
    const sequencesDataset = safeGet(
      handle,
      "sequences",
    ) as H5Dataset | undefined;
    const annotationsDataset = safeGet(
      handle,
      "annotations",
    ) as H5Dataset | undefined;
    if (!samplesDataset || !sequencesDataset || !annotationsDataset) {
      throw new Error("Required HDF5 datasets are missing");
    }
    if (samplesDataset.shape.length !== 2 || samplesDataset.shape[1] !== 6) {
      throw new Error("/samples must have shape [N, 6]");
    }
    const samples = samplesDataset.value;
    if (
      !(samples instanceof Float32Array) ||
      samples.length !== samplesDataset.shape[0] * 6
    ) {
      throw new Error("/samples must contain float32 SI values");
    }
    for (let index = 0; index < samples.length; index += 1) {
      if (!Number.isFinite(samples[index])) {
        throw new Error("/samples contains non-finite values");
      }
    }

    const sequences: Sequence[] = rows(
      sequencesDataset,
      [
        "sample_start",
        "sample_stop",
        "source_file",
        "participant_id",
        "recording_id",
        "body_location",
        "activity_code",
        "is_fall",
        "supervision_kind",
        "source_sampling_rate_hz",
      ],
      "/sequences",
    ).map((row) => ({
      sample_start: integer(row.sample_start, "sample_start"),
      sample_stop: integer(row.sample_stop, "sample_stop"),
      source_file: textValue(row.source_file, "source_file"),
      participant_id: textValue(row.participant_id, "participant_id"),
      recording_id: textValue(row.recording_id, "recording_id"),
      body_location: textValue(row.body_location, "body_location"),
      activity_code: textValue(row.activity_code, "activity_code"),
      is_fall: Boolean(row.is_fall),
      supervision_kind: textValue(row.supervision_kind, "supervision_kind"),
      source_sampling_rate_hz: Number(row.source_sampling_rate_hz),
    }));
    if (
      sequences.length === 0 ||
      sequences[0].sample_start !== 0 ||
      sequences.some(
        (item, index) =>
          item.sample_stop <= item.sample_start ||
          (index > 0 &&
            item.sample_start !== sequences[index - 1].sample_stop),
      ) ||
      sequences.at(-1)?.sample_stop !== samplesDataset.shape[0]
    ) {
      throw new Error("/sequences does not exactly cover /samples");
    }

    const annotations: Annotation[] = rows(
      annotationsDataset,
      ["sequence_index", "kind", "start_sample", "stop_sample", "code"],
      "/annotations",
    ).map((row) => ({
      sequence_index: integer(row.sequence_index, "sequence_index"),
      kind: textValue(row.kind, "annotation kind"),
      start_sample: integer(row.start_sample, "start_sample"),
      stop_sample: integer(row.stop_sample, "stop_sample"),
      code: textValue(row.code, "annotation code"),
    }));
    for (const annotation of annotations) {
      const sequence = sequences[annotation.sequence_index ?? -1];
      const length = sequence
        ? sequence.sample_stop - sequence.sample_start
        : -1;
      if (
        !sequence ||
        !["activity", "onset", "impact", "exclude"].includes(annotation.kind) ||
        !annotation.code ||
        annotation.start_sample < 0 ||
        annotation.start_sample >= length ||
        (["onset", "impact"].includes(annotation.kind)
          ? annotation.stop_sample !== annotation.start_sample
          : annotation.stop_sample <= annotation.start_sample ||
            annotation.stop_sample > length) ||
        (annotation.kind === "exclude" &&
          !["sync_tap", "other"].includes(annotation.code))
      ) {
        throw new Error("/annotations contains an invalid row");
      }
    }
    if (
      integer(attrs.sequence_count, "sequence_count") !== sequences.length ||
      integer(attrs.sample_count, "sample_count") !== samplesDataset.shape[0] ||
      integer(attrs.annotation_count, "annotation_count") !== annotations.length
    ) {
      throw new Error("HDF5 root counts do not match the core tables");
    }

    const hasMedia = Boolean(safeGet(handle, "media"));
    const hasLabels = Boolean(safeGet(handle, "labels"));
    if (profile === "training_dataset" && (hasMedia || hasLabels)) {
      throw new Error("training_dataset must not contain media or labels");
    }
    if (profile === "client_delivery" && (!hasMedia || !hasLabels)) {
      throw new Error("client_delivery must contain media and labels");
    }
    const embedded =
      profile === "client_delivery"
        ? embeddedClientData(handle, attrs, file.size, sequences, annotations)
        : undefined;
    const response: H5Summary = {
      attrs,
      profile,
      sampleCount: samplesDataset.shape[0],
      samples,
      sequences,
      annotations,
      embedded,
    };
    self.postMessage({ ok: true, result: response }, { transfer: [samples.buffer] });
    handle.close();
    handle = undefined;
    FS.unmount(mount);
    FS.rmdir(mount);
  } catch (error) {
    try {
      handle?.close();
    } catch {
      // best effort
    }
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
