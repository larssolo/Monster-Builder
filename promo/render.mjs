// Renders promo/film.html frame-by-frame in headless Chromium and pipes JPEG
// frames into ffmpeg (or writes previews).
//   node render.mjs --lang en --out film_en_video.mp4            full render (video only)
//   node render.mjs --lang en --frames 0,120,300 --preview dir    single frames
//   node render.mjs --lang en --range 0:600 --out part.mp4         partial
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith("--") ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
const lang = args.lang || "en";
const base = args.base || "http://127.0.0.1:8765/promo/film.html";

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on("console", (m) => { const t = m.text(); if (!t.includes("sigmaRadians")) console.log("console:", t); });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(`${base}?lang=${lang}`);
await page.waitForFunction(() => window.FILM && window.FILM.ready, null, { timeout: 120000 });
await page.evaluate(() => window.FILM.ready);
const FRAMES = await page.evaluate(() => window.FILM.FRAMES);
const FPS = await page.evaluate(() => window.FILM.FPS);
const grab = async (f) => {
  const url = await page.evaluate((f) => window.FILM.frameJPEG(f, 0.96), f);
  return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
};

if (args.frames) {
  fs.mkdirSync(args.preview, { recursive: true });
  for (const s of args.frames.split(",")) {
    const f = Math.round(+s), t0 = Date.now();
    fs.writeFileSync(`${args.preview}/f${String(f).padStart(4, "0")}.jpg`, await grab(f));
    console.log("frame", f, Date.now() - t0, "ms");
  }
} else {
  const [a, z] = (args.range || `0:${FRAMES}`).split(":").map(Number);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", args.crf || "16", "-pix_fmt", "yuv420p", "-r", String(FPS), args.out], { stdio: ["pipe", "inherit", "inherit"] });
  const t0 = Date.now();
  for (let f = a; f < z; f++) {
    const buf = await grab(f);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if ((f - a) % 30 === 0) console.log(`frame ${f}/${z}  ${((Date.now() - t0) / (f - a + 1)).toFixed(0)} ms/frame`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  console.log("done", args.out, ((Date.now() - t0) / 1000).toFixed(1), "s");
}
await browser.close();
