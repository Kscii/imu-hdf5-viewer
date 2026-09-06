import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import lock from "../docs/contracts/imu-hdf5-v3.2.lock.json";

describe("contract mirror", () => {
  it("matches the locked canonical digest", () => {
    const body = readFileSync("docs/contracts/imu-hdf5-v3.2.md");
    expect(createHash("sha256").update(body).digest("hex")).toBe(lock.sha256);
    expect(lock.hdf5_schema_version).toBe("3.2.0");
    expect(lock.profiles).toEqual(["training_dataset", "client_delivery"]);
  });
});
