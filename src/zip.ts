const EOCD = 0x06054b50;
const ZIP64_EOCD = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_ENTRIES = 100_000;

export interface ZipEntry {
  name: string;
  size: number;
  compressedSize: number;
  compression: number;
  dataOffset: number;
}

const u16 = (v: DataView, p: number) => v.getUint16(p, true);
const u32 = (v: DataView, p: number) => v.getUint32(p, true);
const u64 = (v: DataView, p: number) => {
  const value = v.getBigUint64(p, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("ZIP offset exceeds browser precision");
  return Number(value);
};

function ensureRange(length: number, offset: number, size: number, label: string) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > length) {
    throw new Error(`Invalid ZIP ${label}`);
  }
}

function safeName(name: string) {
  const parts = name.split("/");
  if (!name || name.startsWith("/") || name.includes("\\") || parts.some((p) => !p || p === "." || p === "..")) {
    throw new Error(`Unsafe ZIP member: ${name}`);
  }
}

function zip64Values(extra: Uint8Array, needs: { size: boolean; compressed: boolean; offset: boolean }) {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let cursor = 0;
  while (cursor + 4 <= extra.length) {
    const id = u16(view, cursor);
    const length = u16(view, cursor + 2);
    cursor += 4;
    ensureRange(extra.length, cursor, length, "extra field");
    if (id === 0x0001) {
      let at = cursor;
      const result: Partial<Record<"size" | "compressed" | "offset", number>> = {};
      for (const key of ["size", "compressed", "offset"] as const) {
        if (needs[key]) {
          if (at + 8 > cursor + length) throw new Error("Incomplete ZIP64 extra field");
          result[key] = u64(view, at);
          at += 8;
        }
      }
      return result;
    }
    cursor += length;
  }
  return {};
}

export class StoredZip {
  readonly entries = new Map<string, ZipEntry>();
  private constructor(readonly file: File) {}

  static async open(file: File): Promise<StoredZip> {
    const zip = new StoredZip(file);
    await zip.parse();
    return zip;
  }

  private async parse() {
    const tailStart = Math.max(0, this.file.size - 65_557);
    const tailBytes = new Uint8Array(await this.file.slice(tailStart).arrayBuffer());
    const tail = new DataView(tailBytes.buffer);
    let eocd = -1;
    for (let at = tailBytes.length - 22; at >= 0; at -= 1) {
      if (u32(tail, at) === EOCD && at + 22 + u16(tail, at + 20) === tailBytes.length) {
        eocd = at;
        break;
      }
    }
    if (eocd < 0) throw new Error("Not a valid ZIP archive");
    let count = u16(tail, eocd + 10);
    let centralSize = u32(tail, eocd + 12);
    let centralOffset = u32(tail, eocd + 16);
    if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      const locatorAt = eocd - 20;
      if (locatorAt < 0 || u32(tail, locatorAt) !== ZIP64_LOCATOR) throw new Error("ZIP64 locator is missing");
      const zip64Offset = u64(tail, locatorAt + 8);
      const header = new DataView(await this.file.slice(zip64Offset, zip64Offset + 56).arrayBuffer());
      if (header.byteLength < 56 || u32(header, 0) !== ZIP64_EOCD) throw new Error("ZIP64 directory is invalid");
      count = u64(header, 32);
      centralSize = u64(header, 40);
      centralOffset = u64(header, 48);
    }
    if (count > MAX_ENTRIES) throw new Error("ZIP contains too many members");
    ensureRange(this.file.size, centralOffset, centralSize, "central directory");
    const centralBytes = new Uint8Array(await this.file.slice(centralOffset, centralOffset + centralSize).arrayBuffer());
    const central = new DataView(centralBytes.buffer);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let cursor = 0;
    for (let index = 0; index < count; index += 1) {
      ensureRange(centralBytes.length, cursor, 46, "central header");
      if (u32(central, cursor) !== CENTRAL) throw new Error("ZIP central header is invalid");
      const flags = u16(central, cursor + 8);
      const compression = u16(central, cursor + 10);
      if ((flags & 1) !== 0) throw new Error("Encrypted ZIP members are unsupported");
      if (compression !== 0) throw new Error("Only ZIP_STORED delivery packages are supported");
      let compressed = u32(central, cursor + 20);
      let size = u32(central, cursor + 24);
      const nameLength = u16(central, cursor + 28);
      const extraLength = u16(central, cursor + 30);
      const commentLength = u16(central, cursor + 32);
      let localOffset = u32(central, cursor + 42);
      const headerSize = 46 + nameLength + extraLength + commentLength;
      ensureRange(centralBytes.length, cursor, headerSize, "central member");
      const name = decoder.decode(centralBytes.slice(cursor + 46, cursor + 46 + nameLength));
      safeName(name);
      if (this.entries.has(name)) throw new Error(`Duplicate ZIP member: ${name}`);
      const extra = centralBytes.slice(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength);
      const extended = zip64Values(extra, {
        size: size === 0xffffffff,
        compressed: compressed === 0xffffffff,
        offset: localOffset === 0xffffffff,
      });
      size = extended.size ?? size;
      compressed = extended.compressed ?? compressed;
      localOffset = extended.offset ?? localOffset;
      const local = new DataView(await this.file.slice(localOffset, localOffset + 30).arrayBuffer());
      if (local.byteLength < 30 || u32(local, 0) !== LOCAL) throw new Error(`Invalid local header: ${name}`);
      const dataOffset = localOffset + 30 + u16(local, 26) + u16(local, 28);
      ensureRange(this.file.size, dataOffset, compressed, `member ${name}`);
      if (size !== compressed) throw new Error(`Stored member sizes disagree: ${name}`);
      this.entries.set(name, { name, size, compressedSize: compressed, compression, dataOffset });
      cursor += headerSize;
    }
    if (this.entries.size !== count) throw new Error("ZIP member count is inconsistent");
  }

  has(name: string) { return this.entries.has(name); }

  blob(name: string, type = "application/octet-stream") {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`ZIP member not found: ${name}`);
    return this.file.slice(entry.dataOffset, entry.dataOffset + entry.size, type);
  }

  async text(name: string, maxBytes = 5 * 1024 * 1024) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`ZIP member not found: ${name}`);
    if (entry.size > maxBytes) throw new Error(`ZIP text member is too large: ${name}`);
    return this.blob(name, "application/json").text();
  }
}
