export function clampSample(sample: number, start: number, stop: number) {
  return Math.min(Math.max(start, Math.round(sample)), Math.max(start, stop - 1));
}

export function moveSample(current: number, delta: number, start: number, stop: number) {
  return clampSample(current + delta, start, stop);
}

export function shouldIgnoreShortcut(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName);
}

export function navigationFromKey(key: string) {
  if (key === "ArrowLeft") return -1;
  if (key === "ArrowRight") return 1;
  if (key === "PageUp") return -25;
  if (key === "PageDown") return 25;
  return undefined;
}

export interface LinearPoint {
  recording_time_ns: number;
  media_time_ns: number;
}

function interpolate(
  points: LinearPoint[],
  value: number,
  source: "recording_time_ns" | "media_time_ns",
  target: "recording_time_ns" | "media_time_ns",
) {
  if (points.length < 2) throw new Error("Timing mapping needs at least two points");
  if (value <= points[0][source]) return points[0][target];
  const last = points.at(-1)!;
  if (value >= last[source]) return last[target];
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle][source] <= value) low = middle;
    else high = middle;
  }
  const left = points[low];
  const right = points[high];
  const ratio = (value - left[source]) / (right[source] - left[source]);
  return left[target] + ratio * (right[target] - left[target]);
}

export function recordingToMediaTime(points: LinearPoint[], recordingTimeNs: number) {
  return interpolate(points, recordingTimeNs, "recording_time_ns", "media_time_ns");
}

export function mediaToRecordingTime(points: LinearPoint[], mediaTimeNs: number) {
  return interpolate(points, mediaTimeNs, "media_time_ns", "recording_time_ns");
}
