import { describe, expect, it } from "vitest";
import { clampSample, moveSample, navigationFromKey } from "../src/playback";

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
});
