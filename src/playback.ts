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
