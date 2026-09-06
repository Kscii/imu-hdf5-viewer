import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { IncrementalSha256 } from "../src/sha256";

describe("incremental SHA-256", () => {
  it("matches the standard digest across uneven chunks", () => {
    const payload = new TextEncoder().encode("abc".repeat(10_003));
    const digest = new IncrementalSha256();
    for (let cursor = 0; cursor < payload.length; cursor += 137) {
      digest.update(payload.subarray(cursor, cursor + 137));
    }
    expect(digest.digestHex()).toBe(
      createHash("sha256").update(payload).digest("hex"),
    );
  });
});
