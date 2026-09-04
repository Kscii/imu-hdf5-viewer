export type Locale = "zh" | "en";

export interface PackageFile {
  path: string;
  size_bytes: number;
  sha256: string;
  role: string;
  recording_id?: string;
}

export interface PackageRecording {
  recording_id: string;
  participant_id: string;
  sequence_index: number;
  merged_sample_start: number;
  merged_sample_stop: number;
  video_path: string;
  view_path: string;
  taxonomy_path: string;
}

export interface PackageManifest {
  schema_version: "cw12eu_client_delivery_v2";
  contract_version: "2.0.0";
  snapshot_id: string;
  snapshot_content_fingerprint: string;
  snapshot_created_at_utc: string;
  hdf5_schema_version: "3.1.0";
  sampling_rate_hz: number;
  coordinate_frame: "sensor_local";
  gravity_retained: true;
  channels: string[];
  video_contains_identifiable_participants: true;
  content_hash_verification: string;
  taxonomies: Array<{ taxonomy_id: string; version: string; path: string }>;
  recordings: PackageRecording[];
  files: PackageFile[];
}

export interface TaxonomyEntry {
  code: string;
  name: string;
  active: boolean;
}

export interface Taxonomy {
  schema_version: "cw12eu_activity_taxonomy_v1";
  taxonomy_id: string;
  version: string;
  fall: TaxonomyEntry[];
  non_fall: TaxonomyEntry[];
}

export interface RecordingView {
  schema_version: string;
  recording_id: string;
  participant_id: string;
  sequence_index: number;
  merged_sample_start: number;
  merged_sample_stop: number;
  sampling_rate_hz: number;
  sample_count: number;
  sample_zero_video_media_time_ns: number;
  taxonomy_id: string;
  taxonomy_version: string;
  annotations: Annotation[];
}

export interface Sequence {
  sample_start: number;
  sample_stop: number;
  source_file: string;
  participant_id: string;
  recording_id: string;
  body_location: string;
  activity_code: string;
  is_fall: boolean;
  supervision_kind: string;
  source_sampling_rate_hz: number;
}

export interface Annotation {
  sequence_index?: number;
  kind: string;
  start_sample: number;
  stop_sample: number;
  code: string;
}

export interface H5Summary {
  attrs: Record<string, string | number | boolean | string[]>;
  sampleCount: number;
  samples: Float32Array;
  sequences: Sequence[];
  annotations: Annotation[];
  embedded?: EmbeddedClientData;
}

export interface EmbeddedVideo {
  sequence_index: number;
  recording_id: string;
  dataset_path: string;
  content_type: string;
  container: string;
  byte_length: number;
  file_offset: number;
  sha256: string;
  media_duration_ns: number;
  sample_zero_video_media_time_ns: number;
}

export interface EmbeddedLabel extends TaxonomyEntry {
  taxonomy_id: string;
  taxonomy_version: string;
  is_fall: boolean;
}

export interface EmbeddedSequenceTaxonomy {
  sequence_index: number;
  taxonomy_id: string;
  taxonomy_version: string;
}

export interface EmbeddedClientData {
  schema_version: "cw12eu_client_hdf5_v1";
  contract_version: "1.0.0";
  videos: EmbeddedVideo[];
  labels: EmbeddedLabel[];
  sequenceTaxonomies: EmbeddedSequenceTaxonomy[];
}

export interface LoadedDelivery {
  source: File;
  h5File: File;
  manifest?: PackageManifest;
  recordings: Array<{
    manifest: PackageRecording;
    view: RecordingView;
    video: Blob;
    taxonomy?: Taxonomy;
  }>;
  packageEntries?: string[];
}
