import type { PackageManifest, RecordingView, Taxonomy } from "./types";

const REQUIRED_CHANNELS = [
  "acceleration_x_mps2",
  "acceleration_y_mps2",
  "acceleration_z_mps2",
  "angular_velocity_x_radps",
  "angular_velocity_y_radps",
  "angular_velocity_z_radps",
];

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} is missing`);
  return value;
}

function safePath(value: unknown, label: string): string {
  const path = nonEmpty(value, label);
  const parts = path.split("/");
  if (path.startsWith("/") || path.includes("\\") || parts.some((p) => !p || p === "." || p === "..")) {
    throw new Error(`${label} is unsafe`);
  }
  return path;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} is invalid`);
  return value;
}

export function parseManifest(input: unknown): PackageManifest {
  const data = object(input, "manifest");
  if (data.schema_version !== "cw12eu_client_delivery_v2") {
    throw new Error("Unsupported package version. Regenerate a v2 delivery package.");
  }
  if (data.contract_version !== "2.0.0") throw new Error("Unsupported contract version");
  if (data.hdf5_schema_version !== "3.1.0") throw new Error("Unsupported HDF5 schema");
  if (data.sampling_rate_hz !== 25) throw new Error("The package is not sampled at 25 Hz");
  if (data.coordinate_frame !== "sensor_local" || data.gravity_retained !== true) {
    throw new Error("Unsupported physical data contract");
  }
  if (JSON.stringify(data.channels) !== JSON.stringify(REQUIRED_CHANNELS)) {
    throw new Error("Unexpected channel order");
  }
  if (!Array.isArray(data.files) || !Array.isArray(data.recordings) || !Array.isArray(data.taxonomies)) {
    throw new Error("The package inventory is incomplete");
  }
  const seen = new Set<string>();
  for (const [index, raw] of data.files.entries()) {
    const file = object(raw, `files[${index}]`);
    const path = safePath(file.path, `files[${index}].path`);
    if (seen.has(path)) throw new Error(`Duplicate manifest path: ${path}`);
    seen.add(path);
    if (!/^[0-9a-f]{64}$/.test(nonEmpty(file.sha256, `${path}.sha256`))) {
      throw new Error(`Invalid SHA-256 descriptor: ${path}`);
    }
    if (!Number.isSafeInteger(file.size_bytes) || (file.size_bytes as number) < 0) {
      throw new Error(`Invalid size descriptor: ${path}`);
    }
  }
  for (const required of ["dataset/cw12eu.h5", "README.md", "DATASET_CARD.md"]) {
    if (!seen.has(required)) throw new Error(`Required package member is missing: ${required}`);
  }
  for (const [index, raw] of data.recordings.entries()) {
    const recording = object(raw, `recordings[${index}]`);
    nonEmpty(recording.recording_id, "recording_id");
    if (!/^cw12eu:subject-[0-9]{3,}$/.test(nonEmpty(recording.participant_id, "participant_id"))) {
      throw new Error("A recording does not use an anonymous subject ID");
    }
    for (const field of ["video_path", "view_path", "taxonomy_path"] as const) {
      const path = safePath(recording[field], field);
      if (!seen.has(path)) throw new Error(`Manifest path is not inventoried: ${path}`);
    }
    const start = number(recording.merged_sample_start, "merged_sample_start");
    const stop = number(recording.merged_sample_stop, "merged_sample_stop");
    if (start < 0 || stop <= start) throw new Error("Invalid merged sample bounds");
  }
  return data as unknown as PackageManifest;
}

export function parseView(input: unknown): RecordingView {
  const data = object(input, "view.json");
  if (data.schema_version !== "cw12eu_snapshot_view_v1") throw new Error("Unsupported view mapping");
  if (!Array.isArray(data.annotations)) throw new Error("view.json annotations are missing");
  number(data.sample_zero_video_media_time_ns, "sample_zero_video_media_time_ns");
  number(data.sample_count, "sample_count");
  return data as unknown as RecordingView;
}

export function parseTaxonomy(input: unknown): Taxonomy {
  const data = object(input, "taxonomy");
  if (data.schema_version !== "cw12eu_activity_taxonomy_v1") throw new Error("Unsupported taxonomy");
  if (!Array.isArray(data.fall) || !Array.isArray(data.non_fall)) throw new Error("Taxonomy entries are missing");
  return data as unknown as Taxonomy;
}
