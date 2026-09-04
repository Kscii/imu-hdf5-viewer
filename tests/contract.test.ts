import { describe, expect, it } from "vitest";
import { parseManifest } from "../src/contract";

const file = (path: string) => ({ path, size_bytes: 1, sha256: "a".repeat(64), role: "fixture" });

function manifest() {
  return {
    schema_version: "cw12eu_client_delivery_v2",
    contract_version: "2.0.0",
    snapshot_id: "snapshot-fixture",
    snapshot_content_fingerprint: "b".repeat(64),
    snapshot_created_at_utc: "2026-09-04T00:00:00Z",
    hdf5_schema_version: "3.1.0",
    sampling_rate_hz: 25,
    coordinate_frame: "sensor_local",
    gravity_retained: true,
    channels: ["acceleration_x_mps2", "acceleration_y_mps2", "acceleration_z_mps2", "angular_velocity_x_radps", "angular_velocity_y_radps", "angular_velocity_z_radps"],
    video_contains_identifiable_participants: true,
    content_hash_verification: "available_not_required_by_viewer",
    taxonomies: [{ taxonomy_id: "cw12eu", version: "1", path: "taxonomies/cw12eu/1.json" }],
    recordings: [{ recording_id: "20260904T000000.000000Z", participant_id: "cw12eu:subject-001", sequence_index: 0, merged_sample_start: 0, merged_sample_stop: 25, video_path: "recordings/0000/video.mp4", view_path: "recordings/0000/view.json", taxonomy_path: "taxonomies/cw12eu/1.json" }],
    files: [file("dataset/cw12eu.h5"), file("README.md"), file("DATASET_CARD.md"), file("recordings/0000/video.mp4"), file("recordings/0000/view.json"), file("taxonomies/cw12eu/1.json")],
  };
}

describe("delivery contract", () => {
  it("accepts v2 and rejects legacy and unsafe manifests", () => {
    expect(parseManifest(manifest()).contract_version).toBe("2.0.0");
    expect(() => parseManifest({ ...manifest(), schema_version: "cw12eu_client_delivery_v1" })).toThrow("Regenerate a v2");
    const unsafe = manifest(); unsafe.files[3].path = "../video.mp4";
    expect(() => parseManifest(unsafe)).toThrow("unsafe");
  });
});
