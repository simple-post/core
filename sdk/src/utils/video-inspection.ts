import { execFile } from "node:child_process";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";

import { downloadToTempFile } from "./media";

const execute = promisify(execFile);
export interface VideoInspection {
  size: number;
  container?: string;
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  codec: string;
  pixelFormat: string;
  sampleAspectRatio: string;
  bitrate?: number;
  audioCodec?: string;
  audioProfile?: string;
  audioChannels?: number;
  audioSampleRate?: number;
}

/** Probe a local file only. ffprobe must never resolve URLs or follow nested network resources. */
export async function inspectVideo(source: { url?: string; path?: string }): Promise<VideoInspection> {
  let temporary: string | undefined;
  try {
    const file = source.url ? (temporary = await downloadToTempFile(source.url)) : source.path;
    if (!file) throw new Error("Missing media source");
    const { stdout } = await execute(
      process.env.FFPROBE_PATH || "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "mov,matroska,webm,avi",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        file,
      ],
      {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        env: {
          NODE_ENV: process.env.NODE_ENV || "production",
          PATH: process.env.PATH,
          SYSTEMROOT: process.env.SYSTEMROOT,
        },
      },
    );
    const data = JSON.parse(stdout);
    const video = data.streams?.find(
      (stream: { codec_type: string; disposition?: { attached_pic?: number } }) =>
        stream.codec_type === "video" && !stream.disposition?.attached_pic,
    );
    const audio = data.streams?.find((stream: { codec_type: string }) => stream.codec_type === "audio");
    const [numerator, denominator] = String(video?.avg_frame_rate ?? "0/1")
      .split("/")
      .map(Number);
    const durationSec = Number(video?.duration ?? data.format?.duration);
    const fps = numerator / denominator;
    const rotation = Number(
      video?.side_data_list?.find((item: { rotation?: number }) => item.rotation !== undefined)?.rotation ??
        video?.tags?.rotate ??
        0,
    );
    const rotated = Math.abs(rotation % 180) === 90;
    const width = Number(rotated ? video?.height : video?.width);
    const height = Number(rotated ? video?.width : video?.height);
    if (![width, height, durationSec, fps].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error("Missing video metadata");
    }
    return {
      size: Number(data.format?.size),
      container: data.format?.format_name,
      width,
      height,
      durationSec,
      fps,
      codec: video.codec_name,
      pixelFormat: video.pix_fmt,
      sampleAspectRatio: video.sample_aspect_ratio ?? "1:1",
      bitrate: Number(video.bit_rate ?? data.format?.bit_rate) || undefined,
      audioCodec: audio?.codec_name,
      audioProfile: audio?.profile,
      audioChannels: audio?.channels,
      audioSampleRate: audio ? Number(audio.sample_rate) : undefined,
    };
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
  }
}
