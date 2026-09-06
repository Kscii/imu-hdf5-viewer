#!/usr/bin/env python3
"""Generate tiny HDF5 3.2 browser fixtures; never publish these as data."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import h5py
import numpy as np


FEATURE_COLUMNS = (
    "acceleration_x_mps2",
    "acceleration_y_mps2",
    "acceleration_z_mps2",
    "angular_velocity_x_rad_s",
    "angular_velocity_y_rad_s",
    "angular_velocity_z_rad_s",
)
FEATURE_UNITS = ("m/s^2", "m/s^2", "m/s^2", "rad/s", "rad/s", "rad/s")


def _text_dtype() -> np.dtype:
    return h5py.string_dtype(encoding="utf-8")


def _sequences() -> np.ndarray:
    text = _text_dtype()
    dtype = np.dtype(
        [
            ("sample_start", "<i8"),
            ("sample_stop", "<i8"),
            ("source_file", text),
            ("participant_id", text),
            ("recording_id", text),
            ("body_location", text),
            ("activity_code", text),
            ("is_fall", "?"),
            ("supervision_kind", text),
            ("source_sampling_rate_hz", "<f8"),
        ]
    )
    return np.asarray(
        [
            (
                0,
                50,
                "fixture",
                "cw12eu:subject-test",
                "cw12eu:recording-test",
                "chest",
                "walking",
                False,
                "temporal",
                25.0,
            )
        ],
        dtype=dtype,
    )


def _annotations() -> np.ndarray:
    text = _text_dtype()
    dtype = np.dtype(
        [
            ("sequence_index", "<i4"),
            ("kind", text),
            ("start_sample", "<i8"),
            ("stop_sample", "<i8"),
            ("code", text),
        ]
    )
    return np.asarray([(0, "activity", 0, 50, "walking")], dtype=dtype)


def _samples() -> np.ndarray:
    time = np.arange(50, dtype=np.float32) / 25.0
    return np.column_stack(
        (
            np.sin(time * 3.0),
            np.cos(time * 2.0),
            np.full_like(time, 9.80665),
            np.sin(time * 5.0) * 0.2,
            np.cos(time * 4.0) * 0.15,
            np.sin(time * 2.0) * 0.1,
        )
    ).astype("<f4")


def _logical_digest(
    samples: np.ndarray, sequences: np.ndarray, annotations: np.ndarray
) -> str:
    def text(value: object) -> str:
        return value.decode() if isinstance(value, bytes) else str(value)

    metadata = {
        "dataset_id": "cw12eu",
        "sampling_rate_hz": 25.0,
        "sequences": [
            {
                "sample_start": int(row["sample_start"]),
                "sample_stop": int(row["sample_stop"]),
                "source_file": text(row["source_file"]),
                "participant_id": text(row["participant_id"]),
                "recording_id": text(row["recording_id"]),
                "body_location": text(row["body_location"]),
                "activity": text(row["activity_code"]),
                "is_fall": bool(row["is_fall"]),
                "original_sampling_rate_hz": float(row["source_sampling_rate_hz"]),
                "supervision_kind": text(row["supervision_kind"]),
            }
            for row in sequences
        ],
        "annotations": [
            {
                "sequence_index": int(row["sequence_index"]),
                "kind": text(row["kind"]),
                "start_sample": int(row["start_sample"]),
                "stop_sample": int(row["stop_sample"]),
                "code": text(row["code"]),
            }
            for row in annotations
        ],
    }
    encoded = json.dumps(metadata, sort_keys=True, separators=(",", ":")).encode()
    values = np.asarray(samples, dtype="<f4", order="C")
    digest = hashlib.sha256()
    digest.update(len(encoded).to_bytes(8, "little"))
    digest.update(encoded)
    digest.update(np.asarray(values.shape, dtype="<i8").tobytes())
    digest.update(values.tobytes())
    return digest.hexdigest()


def _write_core(handle: h5py.File, profile: str) -> None:
    samples = _samples()
    sequences = _sequences()
    annotations = _annotations()
    handle.attrs["imu_schema_version"] = "3.2.0"
    handle.attrs["artifact_profile"] = profile
    handle.attrs["dataset_id"] = "cw12eu"
    handle.attrs["sampling_rate_hz"] = 25.0
    handle.attrs["evaluation_role"] = "training_only"
    handle.attrs["axis_frame"] = "sensor_local"
    handle.attrs["feature_columns"] = json.dumps(FEATURE_COLUMNS)
    handle.attrs["hdf5_compatibility"] = "1.14"
    handle.attrs["sequence_count"] = 1
    handle.attrs["sample_count"] = len(samples)
    handle.attrs["annotation_count"] = len(annotations)
    handle.attrs["logical_content_sha256"] = _logical_digest(
        samples, sequences, annotations
    )
    sample_dataset = handle.create_dataset("samples", data=samples, dtype="<f4")
    sample_dataset.attrs["columns"] = json.dumps(FEATURE_COLUMNS)
    sample_dataset.attrs["units"] = json.dumps(FEATURE_UNITS)
    handle.create_dataset("sequences", data=sequences)
    handle.create_dataset("annotations", data=annotations)


def _make_video(path: Path) -> bytes:
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0x173458:s=320x180:r=25:d=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-an",
            str(path),
        ],
        check=True,
    )
    return path.read_bytes()


def build(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    training_path = output_dir / "training-v3.2.h5"
    client_path = output_dir / "client-v3.2.h5"
    video_path = output_dir / "fixture.mp4"

    with h5py.File(training_path, "w", libver="latest") as handle:
        _write_core(handle, "training_dataset")

    video = _make_video(video_path)
    text = _text_dtype()
    with h5py.File(client_path, "w", libver="latest") as handle:
        _write_core(handle, "client_delivery")
        handle.attrs["client_delivery_contract_version"] = "1.0.0"
        handle.attrs["snapshot_id"] = "snapshot-testfixture00000000"
        handle.attrs["snapshot_content_fingerprint"] = "f" * 64
        handle.attrs["snapshot_created_at_utc"] = "2026-09-05T00:00:00Z"
        handle.attrs["video_contains_identifiable_participants"] = True

        media = handle.create_group("media")
        videos = media.create_group("videos")
        timing = media.create_group("timing")
        video_dataset = videos.create_dataset(
            "0", data=np.frombuffer(video, dtype=np.uint8), chunks=None
        )
        mapping = np.asarray([[0, 0], [1_960_000_000, 1_960_000_000]], dtype="<i8")
        timing_dataset = timing.create_dataset("0", data=mapping, dtype="<i8")
        timing_dataset.attrs["columns"] = json.dumps(
            ["recording_time_ns", "media_time_ns"]
        )
        handle.flush()
        offset = video_dataset.id.get_offset()
        if offset is None:
            raise RuntimeError("fixture video dataset is not contiguous")
        media_dtype = np.dtype(
            [
                ("sequence_index", "<i4"),
                ("byte_length", "<i8"),
                ("file_offset", "<i8"),
                ("sha256", text),
                ("content_type", text),
                ("container", text),
                ("media_duration_ns", "<i8"),
                ("sample_zero_recording_time_ns", "<i8"),
                ("sample_zero_media_time_ns", "<i8"),
            ]
        )
        media.create_dataset(
            "index",
            data=np.asarray(
                [
                    (
                        0,
                        len(video),
                        int(offset),
                        hashlib.sha256(video).hexdigest(),
                        "video/mp4",
                        "mp4",
                        2_000_000_000,
                        0,
                        0,
                    )
                ],
                dtype=media_dtype,
            ),
        )
        labels = handle.create_group("labels")
        catalog_dtype = np.dtype(
            [
                ("taxonomy_id", text),
                ("taxonomy_version", text),
                ("code", text),
                ("name", text),
                ("is_fall", "?"),
                ("active", "?"),
            ]
        )
        labels.create_dataset(
            "catalog",
            data=np.asarray(
                [("activity-v1", "1.0.0", "walking", "Walking", False, True)],
                dtype=catalog_dtype,
            ),
        )
        version_dtype = np.dtype(
            [
                ("sequence_index", "<i4"),
                ("taxonomy_id", text),
                ("taxonomy_version", text),
            ]
        )
        labels.create_dataset(
            "sequence_versions",
            data=np.asarray([(0, "activity-v1", "1.0.0")], dtype=version_dtype),
        )

    video_path.unlink()


if __name__ == "__main__":
    build(Path(sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures"))
