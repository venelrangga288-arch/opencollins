/**
 * Downloads 15 short, royalty-free ad creatives (Mixkit free stock footage,
 * Mixkit License: free for commercial use, no attribution required) and trims
 * each to ~7s of 480p H.264 so a "watch ad" slot loads instantly.
 *
 * Output:
 *   apps/web/public/ads/clip-01.mp4 ... clip-15.mp4
 *   apps/web/public/ads/clip-01.jpg ... clip-15.jpg   (poster frames)
 *   apps/web/public/ads/manifest.json                  (metadata for seeding)
 *
 * Run: node scripts/prepare-ad-creatives.mjs
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

const run = promisify(execFile);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

const OUT_DIR = path.resolve("apps/web/public/ads");
const CATEGORIES = [
  "technology",
  "business",
  "nature",
  "city",
  "abstract",
  "people",
  "sports",
  "food",
];
const TARGET = 15;

/** House-ad copy shown over each clip. Titles are what the operator sees. */
const CREATIVES = [
  { title: "Ship Faster", brand: "dgtlz", tagline: "One endpoint, every model. No rewrites.", accent: "#67dcf2" },
  { title: "Keys in Seconds", brand: "dgtlz", tagline: "Mint a dgtlz_live_ key and start billing usage.", accent: "#5fbf8a" },
  { title: "Know Your Spend", brand: "dgtlz", tagline: "Every token metered. No surprise invoices.", accent: "#febc2e" },
  { title: "Agents That Work", brand: "dgtlz", tagline: "Deploy a coding agent, watch the steps land.", accent: "#a78bfa" },
  { title: "Quota You Control", brand: "dgtlz", tagline: "Daily limits per user, editable in one click.", accent: "#ff8fa8" },
  { title: "Stream It", brand: "dgtlz", tagline: "Server-sent events on every completion.", accent: "#54a3ff" },
  { title: "One Key, Many Models", brand: "dgtlz", tagline: "Swap models without touching your client.", accent: "#67dcf2" },
  { title: "Usage Ledger", brand: "dgtlz", tagline: "Request, tokens, latency, cost â€” all logged.", accent: "#5fbf8a" },
  { title: "Operator Console", brand: "dgtlz", tagline: "Full control of users, keys and quota.", accent: "#f6821f" },
  { title: "Playground", brand: "dgtlz", tagline: "Test any model before you ship it.", accent: "#a78bfa" },
  { title: "Bring Your Own Code", brand: "dgtlz", tagline: "OpenAI-compatible. Paste and go.", accent: "#ff8fa8" },
  { title: "No Lock-In", brand: "dgtlz", tagline: "Standard chat completions schema, nothing else.", accent: "#54a3ff" },
  { title: "Baseline Budget", brand: "dgtlz", tagline: "Set a spend ceiling per account.", accent: "#febc2e" },
  { title: "Quietly Reliable", brand: "dgtlz", tagline: "Retries, rate limits and request IDs built in.", accent: "#5fbf8a" },
  { title: "Build On It", brand: "dgtlz", tagline: "Docs, SDK snippets and a live quota API.", accent: "#67dcf2" },
];

async function scrape(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://mixkit.co/" } });
  if (!res.ok) return [];
  const html = await res.text();
  const ids = new Set();
  for (const m of html.matchAll(/assets\.mixkit\.co\/videos\/(\d+)\/\1-(?:360|720|1080)\.mp4/g)) {
    ids.add(m[1]);
  }
  return [...ids];
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // 1. Collect candidate clip ids across a few categories.
  const ids = [];
  for (const cat of CATEGORIES) {
    if (ids.length >= TARGET * 3) break;
    try {
      const found = await scrape(`https://mixkit.co/free-stock-video/${cat}/`);
      console.log(`[scrape] ${cat}: ${found.length} clips`);
      for (const id of found) if (!ids.includes(id)) ids.push(id);
    } catch (err) {
      console.warn(`[scrape] ${cat} failed: ${err.message}`);
    }
  }
  if (ids.length < TARGET) throw new Error(`only found ${ids.length} clips, need ${TARGET}`);

  const manifest = [];
  for (let i = 0; i < TARGET; i++) {
    const id = ids[i];
    const n = String(i + 1).padStart(2, "0");
    const mp4 = path.join(OUT_DIR, `clip-${n}.mp4`);
    const jpg = path.join(OUT_DIR, `clip-${n}.jpg`);
    const src = `https://assets.mixkit.co/videos/${id}/${id}-360.mp4`;
    try {
      await run(FFMPEG, [
        "-y", "-loglevel", "error",
        "-user_agent", UA, "-referer", "https://mixkit.co/",
        "-i", src,
        "-t", "7",
        "-an",
        "-vf", "scale=640:-2,fps=24",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        mp4,
      ], { maxBuffer: 1 << 26 });
      await run(FFMPEG, [
        "-y", "-loglevel", "error",
        "-ss", "1", "-i", mp4, "-frames:v", "1", "-q:v", "5",
        "-vf", "scale=640:-2",
        jpg,
      ], { maxBuffer: 1 << 26 });

      // ffprobe, not ffmpeg: `-show_entries` belongs to the probe binary.
      const { stdout } = await run(FFPROBE, [
        "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4,
      ]);
      const durationMs = Math.round(Number.parseFloat(stdout.trim()) * 1000);
      const copy = CREATIVES[i];
      manifest.push({
        slug: `clip-${n}`,
        title: copy.title,
        brand: copy.brand,
        tagline: copy.tagline,
        accent: copy.accent,
        videoUrl: `/ads/clip-${n}.mp4`,
        posterUrl: `/ads/clip-${n}.jpg`,
        durationMs: durationMs > 1000 ? durationMs : 7000,
        sourceUrl: `https://mixkit.co/free-stock-video/?q=${id}`,
        license: "Mixkit Free License (commercial use, no attribution)",
      });
      console.log(`[ok] clip-${n} (${durationMs}ms) <- mixkit#${id}`);
    } catch (err) {
      console.warn(`[skip] mixkit#${id}: ${err.message.split("\n")[0]}`);
    }
  }

  if (!manifest.length) throw new Error("no clips produced");
  await writeFile(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\nDone: ${manifest.length} creatives -> ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
