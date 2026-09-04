import { describe, expect, it } from "vitest";
import { StoredZip } from "../src/zip";

const encoder = new TextEncoder();
const put16 = (view: DataView, at: number, value: number) => view.setUint16(at, value, true);
const put32 = (view: DataView, at: number, value: number) => view.setUint32(at, value, true);

function storedZip(name: string, content: string, compression = 0) {
  const filename = encoder.encode(name);
  const bytes = encoder.encode(content);
  const localLength = 30 + filename.length + bytes.length;
  const centralLength = 46 + filename.length;
  const output = new Uint8Array(localLength + centralLength + 22);
  const view = new DataView(output.buffer);
  put32(view, 0, 0x04034b50); put16(view, 4, 20); put16(view, 8, compression);
  put32(view, 18, bytes.length); put32(view, 22, bytes.length); put16(view, 26, filename.length);
  output.set(filename, 30); output.set(bytes, 30 + filename.length);
  const central = localLength;
  put32(view, central, 0x02014b50); put16(view, central + 4, 20); put16(view, central + 6, 20); put16(view, central + 10, compression);
  put32(view, central + 20, bytes.length); put32(view, central + 24, bytes.length); put16(view, central + 28, filename.length);
  output.set(filename, central + 46);
  const eocd = central + centralLength;
  put32(view, eocd, 0x06054b50); put16(view, eocd + 8, 1); put16(view, eocd + 10, 1);
  put32(view, eocd + 12, centralLength); put32(view, eocd + 16, central);
  return new File([output], "fixture.zip", { type: "application/zip" });
}

describe("StoredZip", () => {
  it("reads a stored member without unpacking the whole archive", async () => {
    const zip = await StoredZip.open(storedZip("manifest.json", "{\"ok\":true}"));
    expect(await zip.text("manifest.json")).toBe("{\"ok\":true}");
    expect(zip.entries.get("manifest.json")?.size).toBe(11);
  });

  it("rejects traversal and compressed members", async () => {
    await expect(StoredZip.open(storedZip("../secret", "x"))).rejects.toThrow("Unsafe ZIP member");
    await expect(StoredZip.open(storedZip("file.txt", "x", 8))).rejects.toThrow("ZIP_STORED");
  });
});
