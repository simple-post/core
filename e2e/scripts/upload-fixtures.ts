// Local-only generator for the large upload-acceptance originals used by
// `--profile uploads`. The files are deliberately ignored by git and excluded
// from the ordinary fixture manifest; `yarn e2e:fixtures` never needs them.
// Requires ffmpeg/ffprobe on PATH for the video and sharp for the image.
// Nothing here touches the network or any account configuration.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { filenames } from "../src/media.js";

const dir = path.resolve("fixtures/generated");
const MiB = 1024 * 1024;
// Verifier identity colors: the browser/Telegram observers expect the centre
// half of an image fixture to average the blue below (image-2 uses the gold).
const blue = [37, 150, 190] as const;
const gold = [246, 190, 0] as const;
const image = {
  file: filenames.uploadImage,
  size: 1080,
  noiseAmplitude: 40,
  // Bluesky's SDK limit is 2,000,000 bytes; stay clearly below it while still
  // being a substantial original that exercises the hosted upload path.
  minBytes: Math.ceil(0.75 * MiB),
  maxBytes: Math.floor(1.9 * MiB),
  qualities: [100, 97, 95, 93, 91, 89, 87, 85, 83, 81, 79, 77, 75, 72, 70, 67, 65, 62, 60],
};
const video = {
  file: filenames.uploadVideo,
  width: 720,
  height: 1280,
  fps: 24,
  seconds: 30,
  bitrate: "8M",
  // 8 Mbps × 30 s ≈ 29 MiB plus audio; the range catches rate-control drift
  // without accepting a file that misses Telegram's 50 MB bot upload limit.
  minBytes: 20 * MiB,
  maxBytes: 45 * MiB,
};

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * MiB });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} failed (install ffmpeg/ffprobe to generate the upload fixtures): ${result.error?.message ?? result.stderr}`,
    );
  return result.stdout;
}
function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
function describeBytes(bytes: number) {
  return `${bytes} bytes (${(bytes / MiB).toFixed(2)} MiB)`;
}
async function replaceFile(target: string, bytes: Buffer) {
  const temporary = `${target}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, target);
}

async function generateImage() {
  const { size, noiseAmplitude } = image;
  const raw = Buffer.alloc(size * size * 3);
  // xorshift32: deterministic high-entropy noise without any external input.
  let seed = 0x5eed0123;
  const next = () => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // Keep the whole image predominantly blue for the existing fingerprint.
      // A narrow striped frame stays recognisable after platform reencoding.
      const frame = x < 64 || x >= size - 64 || y < 64 || y >= size - 64;
      const base = frame && Math.floor((x + y) / 72) % 2 ? gold : blue;
      for (let c = 0; c < 3; c++) {
        const noise = (next() % (2 * noiseAmplitude + 1)) - noiseAmplitude;
        raw[(y * size + x) * 3 + c] = Math.min(255, Math.max(0, base[c] + noise));
      }
    }
  const source = sharp(raw, { raw: { width: size, height: size, channels: 3 } });
  let chosen: { quality: number; bytes: Buffer } | undefined;
  const attempts: string[] = [];
  for (const quality of image.qualities) {
    const bytes = await source.clone().jpeg({ quality, chromaSubsampling: "4:4:4" }).toBuffer();
    attempts.push(`q${quality}=${bytes.length}`);
    if (bytes.length >= image.minBytes && bytes.length <= image.maxBytes) {
      chosen = { quality, bytes };
      break;
    }
  }
  if (!chosen)
    throw new Error(
      `No JPEG quality produced ${describeBytes(image.minBytes)}–${describeBytes(image.maxBytes)}: ${attempts.join(", ")}`,
    );
  // Mirror src/verification/image.ts: the decoded centre half must average the
  // blue fixture color within 35 per channel, or live verification would fail.
  const metadata = await sharp(chosen.bytes).metadata();
  if (metadata.width !== size || metadata.height !== size || metadata.format !== "jpeg")
    throw new Error(`Unexpected image encoding: ${metadata.format} ${metadata.width}×${metadata.height}`);
  const stats = await sharp(chosen.bytes)
    .extract({ left: size / 4, top: size / 4, width: size / 2, height: size / 2 })
    .stats();
  blue.forEach((channel, c) => {
    const drift = Math.abs(stats.channels[c].mean - channel);
    if (drift >= 35) throw new Error(`Centre channel ${c} mean drifts ${drift.toFixed(1)} from the blue fixture color`);
  });
  await replaceFile(path.join(dir, image.file), chosen.bytes);
  return {
    bytes: chosen.bytes.length,
    sha256: sha256(chosen.bytes),
    width: size,
    height: size,
    format: "jpeg",
    chromaSubsampling: "4:4:4",
    quality: chosen.quality,
    centreMean: stats.channels.slice(0, 3).map((channel) => Number(channel.mean.toFixed(1))),
  };
}

type Probe = {
  format?: { format_name?: string; duration?: string; bit_rate?: string; size?: string };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    pix_fmt?: string;
    r_frame_rate?: string;
    avg_frame_rate?: string;
    duration?: string;
    sample_rate?: string;
    profile?: string;
  }[];
};
async function generateVideo() {
  const target = path.join(dir, video.file);
  const temporary = `${target}.tmp.mp4`;
  const { width, height, fps, seconds } = video;
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=${width}x${height}:rate=${fps}`,
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    String(seconds),
    // Seeded temporal noise makes the pattern expensive enough that x264
    // actually spends the 8 Mbps budget instead of undershooting it.
    "-filter:v",
    "noise=all_seed=20260311:all_strength=14:all_flags=t,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-profile:v",
    "high",
    "-b:v",
    video.bitrate,
    "-maxrate",
    video.bitrate,
    "-bufsize",
    "16M",
    "-g",
    String(fps * 2),
    "-r",
    String(fps),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-shortest",
    "-movflags",
    "+faststart",
    "-fflags",
    "+bitexact",
    "-flags:v",
    "+bitexact",
    "-flags:a",
    "+bitexact",
    "-f",
    "mp4",
    temporary,
  ]);
  try {
    const probe = JSON.parse(
      run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", temporary]),
    ) as Probe;
    const streams = probe.streams ?? [];
    const videoStreams = streams.filter((s) => s.codec_type === "video");
    const audioStreams = streams.filter((s) => s.codec_type === "audio");
    const problems: string[] = [];
    if (videoStreams.length !== 1) problems.push(`expected one video stream, found ${videoStreams.length}`);
    if (audioStreams.length !== 1) problems.push(`expected one audio stream, found ${audioStreams.length}`);
    const [v] = videoStreams;
    const [a] = audioStreams;
    if (v?.codec_name !== "h264") problems.push(`video codec ${v?.codec_name}, expected h264`);
    if (v?.pix_fmt !== "yuv420p") problems.push(`pixel format ${v?.pix_fmt}, expected yuv420p`);
    if (v?.width !== width || v?.height !== height)
      problems.push(`dimensions ${v?.width}×${v?.height}, expected ${width}×${height}`);
    const rate = (v?.r_frame_rate ?? "").split("/").map(Number);
    const measuredFps = rate.length === 2 && rate[1] ? rate[0] / rate[1] : Number(v?.r_frame_rate);
    if (Math.abs(measuredFps - fps) > 0.01) problems.push(`frame rate ${v?.r_frame_rate}, expected ${fps}`);
    if (a?.codec_name !== "aac") problems.push(`audio codec ${a?.codec_name}, expected aac`);
    if (!(probe.format?.format_name ?? "").split(",").includes("mp4"))
      problems.push(`container ${probe.format?.format_name}, expected mp4`);
    const durationSec = Number(probe.format?.duration);
    // The YouTube owner readback compares the source duration within 100 ms.
    if (!(Math.abs(durationSec - seconds) <= 0.1))
      problems.push(`container duration ${probe.format?.duration}s, expected ${seconds}s ±0.1`);
    const bytes = await readFile(temporary);
    if (bytes.length < video.minBytes || bytes.length > video.maxBytes)
      problems.push(
        `size ${describeBytes(bytes.length)} outside ${describeBytes(video.minBytes)}–${describeBytes(video.maxBytes)}`,
      );
    const moov = bytes.indexOf("moov"),
      mdat = bytes.indexOf("mdat");
    const faststart = moov >= 0 && mdat >= 0 && moov < mdat;
    if (!faststart) problems.push("moov atom is not before mdat (faststart missing)");
    if (problems.length) throw new Error(`Generated video rejected: ${problems.join("; ")}`);
    await rename(temporary, target);
    return {
      bytes: bytes.length,
      sha256: sha256(bytes),
      width,
      height,
      durationSec: Number(durationSec.toFixed(3)),
      fps,
      videoCodec: v!.codec_name,
      videoProfile: v!.profile,
      pixelFormat: v!.pix_fmt,
      audioCodec: a!.codec_name,
      audioSampleRate: Number(a!.sample_rate),
      bitRate: Number(probe.format?.bit_rate) || undefined,
      faststart,
    };
  } finally {
    await rm(temporary, { force: true });
  }
}

await mkdir(dir, { recursive: true });
const files = {
  [image.file]: await generateImage(),
  [video.file]: await generateVideo(),
};
const manifest = {
  note: "Local-only upload-acceptance originals for `--profile uploads`. Ignored by git; regenerate with yarn e2e:upload-fixtures.",
  limits: {
    [image.file]: { minBytes: image.minBytes, maxBytes: image.maxBytes },
    [video.file]: { minBytes: video.minBytes, maxBytes: video.maxBytes },
  },
  files,
};
await replaceFile(path.join(dir, "upload-manifest.json"), Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
for (const [file, info] of Object.entries(files))
  console.log(`${file}: ${describeBytes(info.bytes)} sha256=${info.sha256}`);
console.log(`Wrote ${path.join(dir, "upload-manifest.json")}. These files are ignored by git; do not commit them.`);
