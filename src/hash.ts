export interface HashTask {
  promise: Promise<string>;
  cancel: () => void;
}

export function hashFile(
  file: File,
  onProgress: (loaded: number, total: number) => void,
): HashTask {
  const worker = new Worker(new URL("./hash.worker.ts", import.meta.url), {
    type: "module",
  });
  const promise = new Promise<string>((resolve, reject) => {
    worker.onmessage = (
      event: MessageEvent<
        | { type: "progress"; loaded: number; total: number }
        | { type: "complete"; sha256: string }
        | { type: "cancelled" }
        | { type: "error"; error: string }
      >,
    ) => {
      if (event.data.type === "progress") {
        onProgress(event.data.loaded, event.data.total);
      } else if (event.data.type === "complete") {
        worker.terminate();
        resolve(event.data.sha256);
      } else if (event.data.type === "cancelled") {
        worker.terminate();
        reject(new DOMException("SHA-256 calculation cancelled", "AbortError"));
      } else {
        worker.terminate();
        reject(new Error(event.data.error));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage({ type: "start", file });
  });
  return {
    promise,
    cancel: () => worker.postMessage({ type: "cancel" }),
  };
}
