import type { H5Summary } from "./types";

export function inspectH5(file: File): Promise<H5Summary> {
  const worker = new Worker(new URL("./h5.worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: H5Summary; error?: string }>) => {
      worker.terminate();
      if (event.data.ok && event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error || "Unable to inspect HDF5 file"));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage(file);
  });
}
