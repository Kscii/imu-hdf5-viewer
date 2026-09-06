/// <reference lib="webworker" />

import { IncrementalSha256 } from "./sha256";

const CHUNK_BYTES = 8 * 1024 * 1024;
let cancelled = false;

self.onmessage = async (
  event: MessageEvent<{ type: "start"; file: File } | { type: "cancel" }>,
) => {
  if (event.data.type === "cancel") {
    cancelled = true;
    return;
  }
  cancelled = false;
  const file = event.data.file;
  const digest = new IncrementalSha256();
  try {
    let cursor = 0;
    while (cursor < file.size) {
      if (cancelled) {
        self.postMessage({ type: "cancelled" });
        return;
      }
      const stop = Math.min(file.size, cursor + CHUNK_BYTES);
      digest.update(new Uint8Array(await file.slice(cursor, stop).arrayBuffer()));
      cursor = stop;
      self.postMessage({ type: "progress", loaded: cursor, total: file.size });
    }
    self.postMessage({ type: "complete", sha256: digest.digestHex() });
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
