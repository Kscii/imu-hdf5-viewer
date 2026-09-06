import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fixture = (name: string) => resolve("tests/fixtures", name);

test("opens and navigates a training_dataset", async ({ page }) => {
  const path = fixture("training-v3.2.h5");
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect(page.getByText(/training_dataset/).last()).toBeVisible();
  await expect(page.getByText("50", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: /Calculate whole-file SHA-256|计算整个文件 SHA-256/ })
    .click();
  await expect(page.locator(".integrity-bar code")).toHaveText(
    createHash("sha256").update(readFileSync(path)).digest("hex"),
  );
  await page.getByRole("button", { name: /Recordings & video|录制与视频/ }).click();
  await expect(page.locator(".empty-video.compact")).toBeVisible();
  await page.getByRole("button", { name: "+1", exact: true }).click();
  await expect(page.locator(".playback output")).toContainText("1 / 49");
  await page.getByRole("button", { name: /Play|播放/ }).click();
  await page.waitForTimeout(160);
  await expect(page.locator(".playback output")).not.toContainText("1 / 49");
});

test("opens a client_delivery and exposes embedded video", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixture("client-v3.2.h5"));
  await expect(page.getByText(/client_delivery/).last()).toBeVisible();
  await page.getByRole("button", { name: /Recordings & video|录制与视频/ }).click();
  const video = page.locator("video");
  await expect(video).toBeVisible();
  // Playwright's Linux Chromium build excludes patented H.264 codecs. Firefox,
  // WebKit, system Chromium, Edge and Chrome exercise metadata decode; Chromium
  // CI still verifies HDF5 range extraction and creation of the media element.
  if (testInfo.project.name !== "chromium") {
    await expect
      .poll(() => video.evaluate((element) => element.readyState))
      .toBeGreaterThanOrEqual(1);
  }
  await page.getByRole("button", { name: "+1", exact: true }).click();
  await expect(page.locator(".playback output")).toContainText("1 / 49");
  await expect(page.getByText(/activity · Walking/)).toBeVisible();
});
