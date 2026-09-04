import { parseManifest, parseTaxonomy, parseView } from "./contract";
import type { LoadedDelivery } from "./types";
import { StoredZip } from "./zip";

function asFile(blob: Blob, name: string, type: string) {
  return new File([blob], name, { type, lastModified: 0 });
}

export async function loadSelectedFile(file: File): Promise<LoadedDelivery> {
  if (/\.h5$/i.test(file.name)) {
    return { source: file, h5File: file, recordings: [] };
  }
  if (!/\.zip$/i.test(file.name)) throw new Error("Select a .zip or .h5 file");
  const zip = await StoredZip.open(file);
  const manifest = parseManifest(JSON.parse(await zip.text("manifest.json")));
  for (const descriptor of manifest.files) {
    const entry = zip.entries.get(descriptor.path);
    if (!entry) throw new Error(`Inventoried member is missing: ${descriptor.path}`);
    if (entry.size !== descriptor.size_bytes) throw new Error(`Member size does not match the manifest: ${descriptor.path}`);
  }
  for (const name of zip.entries.keys()) {
    if (name === "manifest.json" || name === "SHA256SUMS") continue;
    if (!manifest.files.some((entry) => entry.path === name)) throw new Error(`Uninventoried ZIP member: ${name}`);
  }
  const h5File = asFile(zip.blob("dataset/cw12eu.h5", "application/x-hdf5"), "cw12eu.h5", "application/x-hdf5");
  const taxonomyCache = new Map<string, ReturnType<typeof parseTaxonomy>>();
  const recordings = [];
  for (const recording of manifest.recordings) {
    let taxonomy = taxonomyCache.get(recording.taxonomy_path);
    if (!taxonomy) {
      taxonomy = parseTaxonomy(JSON.parse(await zip.text(recording.taxonomy_path)));
      taxonomyCache.set(recording.taxonomy_path, taxonomy);
    }
    const view = parseView(JSON.parse(await zip.text(recording.view_path)));
    if (
      view.recording_id !== recording.recording_id ||
      view.participant_id !== recording.participant_id ||
      view.sequence_index !== recording.sequence_index ||
      view.merged_sample_start !== recording.merged_sample_start ||
      view.merged_sample_stop !== recording.merged_sample_stop
    ) throw new Error(`Recording/view identity mismatch: ${recording.recording_id}`);
    recordings.push({
      manifest: recording,
      view,
      video: zip.blob(recording.video_path, "video/mp4"),
      taxonomy,
    });
  }
  return { source: file, h5File, manifest, recordings, packageEntries: [...zip.entries.keys()].sort() };
}
