import { describe, expect, it } from "vitest";
import {
  clampSample,
  mediaToRecordingTime,
  moveSample,
  navigationFromKey,
  recordingToMediaTime,
} from "../src/playback";

describe("playback navigation", () => {
  it("clamps every seek to the selected recording", () => {
    expect(clampSample(99, 100, 200)).toBe(100);
    expect(clampSample(150.6, 100, 200)).toBe(151);
    expect(clampSample(999, 100, 200)).toBe(199);
  });

  it("moves by one sample or one second at 25 Hz", () => {
    expect(moveSample(150, navigationFromKey("ArrowLeft")!, 100, 200)).toBe(149);
    expect(moveSample(150, navigationFromKey("PageDown")!, 100, 200)).toBe(175);
  });

  it("interpolates the frozen recording/media timing in both directions", () => {
    const points = [
      { recording_time_ns: 100, media_time_ns: 1_000 },
      { recording_time_ns: 200, media_time_ns: 1_300 },
      { recording_time_ns: 400, media_time_ns: 1_500 },
    ];
    expect(recordingToMediaTime(points, 150)).toBe(1_150);
    expect(mediaToRecordingTime(points, 1_400)).toBe(300);
    expect(recordingToMediaTime(points, 0)).toBe(1_000);
    expect(mediaToRecordingTime(points, 9_999)).toBe(400);
  });
});
