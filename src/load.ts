import type { LoadedDelivery } from "./types";

export async function loadSelectedFile(file: File): Promise<LoadedDelivery> {
  if (!/\.h5$/i.test(file.name)) {
    throw new Error("Select an HDF5 3.2 .h5 file");
  }
  if (file.size <= 0) {
    throw new Error("The selected HDF5 file is empty");
  }
  return { source: file, h5File: file };
}
