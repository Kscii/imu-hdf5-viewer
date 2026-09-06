export type Locale = "zh" | "en";

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

export interface TimingPoint {
  recording_time_ns: number;
  media_time_ns: number;
}

export interface EmbeddedVideo {
  sequence_index: number;
  content_type: string;
  container: string;
  byte_length: number;
  file_offset: number;
  sha256: string;
  media_duration_ns: number;
  sample_zero_recording_time_ns: number;
  sample_zero_media_time_ns: number;
  timing: TimingPoint[];
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
  contract_version: "1.0.0";
  videos: EmbeddedVideo[];
  labels: EmbeddedLabel[];
  sequenceTaxonomies: EmbeddedSequenceTaxonomy[];
}

export interface H5Summary {
  attrs: Record<string, string | number | boolean | string[]>;
  profile: "training_dataset" | "client_delivery";
  sampleCount: number;
  samples: Float32Array;
  sequences: Sequence[];
  annotations: Annotation[];
  embedded?: EmbeddedClientData;
}

export interface LoadedDelivery {
  source: File;
  h5File: File;
}
