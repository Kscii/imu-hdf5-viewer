import { chromium } from "@playwright/test";

const [baseURL, fixturePath, screenshotPath, mode] = process.argv.slice(2);
const expectNoVideo = mode === "no-video";
if (!baseURL || !fixturePath) {
  throw new Error("usage: node scripts/accept-client-h5.mjs <base-url> <file.h5> [screenshot.png] [no-video]");
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
});
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("console", (message) => process.stderr.write(`[browser:${message.type()}] ${message.text()}\n`));
  page.on("pageerror", (error) => process.stderr.write(`[browser:error] ${error.message}\n`));
  await page.goto(baseURL);
  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  try {
    await page.getByText(/客户 H5 包含可识别视频|client HDF5 contains identifiable video|训练数据 H5 不含视频|training HDF5 has no video/).waitFor({ timeout: 120_000 });
  } catch (error) {
    if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
    process.stderr.write(`${(await page.locator("body").innerText()).slice(0, 4000)}\n`);
    throw error;
  }
  await page.getByRole("button", { name: /录制与视频|Recordings & video/ }).click();
  await page.getByRole("button", { name: "+1", exact: true }).click();
  let position = await page.locator(".playback output").innerText();
  if (!position.includes("1 /")) throw new Error(`sample navigation did not move: ${position}`);
  let media;
  if (expectNoVideo) {
    await page.locator(".empty-video.compact").waitFor();
    await page.getByRole("button", { name: /播放|Play/ }).click();
    await page.waitForTimeout(140);
    await page.getByRole("button", { name: /暂停|Pause/ }).click();
    position = await page.locator(".playback output").innerText();
    if (/· [01] \//u.test(position)) throw new Error(`synthetic playback did not advance: ${position}`);
  } else {
    const video = page.locator("video");
    await video.waitFor({ timeout: 30_000 });
    media = await video.evaluate((element) => ({
      readyState: element.readyState,
      duration: element.duration,
      error: element.error?.message,
    }));
    if (media.error || media.readyState < 1 || !Number.isFinite(media.duration)) {
      throw new Error(`embedded MP4 did not load: ${JSON.stringify(media)}`);
    }
  }
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.getByRole("button", { name: /HDF5 结构|HDF5 structure/ }).click();
  await page.getByRole("button", { name: /打开高级 HDF5 视图|Open advanced HDF5 view/ }).click();
  await page.getByRole("button", { name: /返回数据查看器|Back to data viewer/ }).waitFor({ timeout: 30_000 });
  await page.getByText("samples", { exact: true }).first().waitFor({ timeout: 120_000 });
  if (screenshotPath) await page.screenshot({ path: screenshotPath.replace(/\.png$/iu, ".advanced.png"), fullPage: true });
  process.stdout.write(`${JSON.stringify({ position, media, expectNoVideo })}\n`);
} finally {
  await browser.close();
}
