const DIRECTORY = "cw12eu-viewer-temporary";

async function root() {
  if (!navigator.storage?.getDirectory) throw new Error("OPFS is unavailable in this browser");
  return navigator.storage.getDirectory();
}

export async function cleanupTemporaryStorage() {
  try {
    const directory = await root();
    await directory.removeEntry(DIRECTORY, { recursive: true });
  } catch (error) {
    if (error instanceof DOMException && ["NotFoundError", "NoModificationAllowedError", "NotAllowedError"].includes(error.name)) return;
    if (error instanceof Error && error.message.includes("unavailable")) return;
    throw error;
  }
}

export async function copyToTemporaryStorage(
  blob: Blob,
  filename: string,
  onProgress: (ratio: number) => void,
): Promise<File> {
  const estimate = await navigator.storage.estimate();
  const available = (estimate.quota ?? 0) - (estimate.usage ?? 0);
  if (available && available < blob.size + 64 * 1024 * 1024) {
    throw new Error("There is not enough browser temporary storage for this video");
  }
  const storage = await root();
  const directory = await storage.getDirectoryHandle(DIRECTORY, { create: true });
  const handle = await directory.getFileHandle(filename.replace(/[^A-Za-z0-9._-]/g, "_"), { create: true });
  const writable = await handle.createWritable();
  const reader = blob.stream().getReader();
  let written = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      written += value.byteLength;
      onProgress(blob.size ? written / blob.size : 1);
    }
    await writable.close();
  } catch (error) {
    await writable.abort();
    throw error;
  }
  return handle.getFile();
}
