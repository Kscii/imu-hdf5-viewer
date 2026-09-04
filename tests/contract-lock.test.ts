import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import lock from "../docs/contracts/client-delivery-contract.lock.json";

describe("contract mirror", () => {
  it("matches the locked canonical digest", () => {
    const body = readFileSync("docs/contracts/client-delivery-contract.md");
    expect(createHash("sha256").update(body).digest("hex")).toBe(lock.sha256);
    expect(lock.contract_version).toBe("2.0.0");
  });
});
