import type { Platform } from "../types/post";
import type { ValidationIssue } from "../types/validation";
import type { MediaInspection } from "../utils/media-inspection";

/** Endpoint-specific hard requirements. Recommendations stay warnings; see VALIDATION.md for sources. */
export function validateInspectedMedia(
  platform: Platform,
  media: MediaInspection,
  context: { mediaCount: number; thumbnail?: boolean },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (
    code: string,
    message: string,
    actual?: number,
    limit?: number,
    severity: "error" | "warning" = "error",
  ) => issues.push({ platform, severity, code, message, actual, limit });
  const range = (name: string, value: number, min: number, max: number) => {
    if (value < min || value > max)
      add(
        `media_${name}_unsupported`,
        `${platform}: ${name} is ${Number(value.toFixed(3))}; use ${min}–${max}.`,
        value,
        value < min ? min : max,
      );
  };
  const { width, height } = media;
  if (media.contentType.startsWith("image/")) {
    if (!width || !height) {
      add(
        "image_dimensions_unavailable",
        "Could not measure this image. Export it again and upload the original file.",
      );
      return issues;
    }
    const ratio = width / height;
    if (platform === "instagram") range("aspect_ratio", ratio, 0.8, 1.91);
    if (platform === "threads" && (ratio < 0.01 || ratio > 10))
      add(
        "image_ratio_unverified",
        "This extreme Threads image ratio may be rejected; crop to a conventional portrait or landscape ratio.",
        undefined,
        undefined,
        "warning",
      );
    if (platform === "telegram") {
      range("width_plus_height", width + height, 2, 10_000);
      range("aspect_ratio", Math.max(ratio, 1 / ratio), 1, 20);
    }
    if (platform === "linkedin") {
      range("pixel_count", width * height, 1, 36_152_319);
      range("animation_frames", media.frames ?? 1, 1, 250);
    }
    if (platform === "tiktok" && (Math.min(width, height) > 1080 || Math.max(width, height) > 1920)) {
      add(
        "photo_dimensions_too_large",
        `TikTok photo is ${width}×${height}. Resize to fit 1080×1920 portrait or 1920×1080 landscape.`,
      );
    }
    if (platform === "x" && (media.frames ?? 1) > 1) {
      if (context.mediaCount !== 1)
        add("animated_gif_must_be_alone", "X animated GIFs must be posted alone. Remove the other attachments.");
      range("animation_width", width, 1, 1280);
      range("animation_height", height, 1, 1080);
      range("animation_frames", media.frames!, 1, 350);
      range("animation_pixels", width * height * media.frames!, 1, 300_000_000);
    }
    if (platform === "pinterest" && context.thumbnail !== true && ratio !== 2 / 3)
      add(
        "recommended_image_ratio",
        "Pinterest recommends a 2:3 image. Other ratios may be cropped in feeds.",
        undefined,
        undefined,
        "warning",
      );
    for (const issue of issues) issue.message = `${width}×${height} image: ${issue.message}`;
    return issues;
  }
  const video = media.video;
  if (!video) {
    add(
      "video_metadata_unavailable",
      "Could not inspect the video duration and encoding. Upload a complete playable video; validation is incomplete.",
    );
    return issues;
  }
  const ratio = video.width / video.height;
  const codec = (allowed: string[]) => {
    if (!allowed.includes(video.codec))
      add(
        "video_codec_unsupported",
        `${platform}: ${video.codec} video is unsupported. Export using ${allowed.join(" or ")}.`,
      );
  };
  const audio = () => {
    if (video.audioCodec && video.audioCodec !== "aac")
      add("audio_codec_unsupported", `${platform}: export the audio track as AAC.`);
  };
  if (platform === "instagram" || platform === "threads") {
    codec(["h264", "hevc"]);
    if (platform === "instagram") {
      if (!["video/mp4", "video/quicktime"].includes(media.contentType))
        add("video_container_unsupported", "Instagram videos must use an MP4 or MOV container.");
      if (context.mediaCount === 1) range("width", video.width, 1, 1920);
      if (video.audioSampleRate && video.audioSampleRate !== 48_000)
        add(
          "audio_sample_rate_recommendation",
          "Instagram documents 48 kHz AAC audio. Re-export at 48 kHz if this track is rejected.",
          undefined,
          undefined,
          "warning",
        );
    }
    audio();
    const maxDuration = platform === "threads" ? 300 : 900;
    range(
      "duration_seconds",
      video.durationSec,
      platform === "instagram" ? 3 : 0.001,
      platform === "instagram" && context.mediaCount > 1 ? 60 : maxDuration,
    );
    range("frames_per_second", video.fps, 23, 60);
    if (platform === "instagram" && context.mediaCount > 1) range("aspect_ratio", ratio, 0.8, 1.91);
    if (video.bitrate) range("bitrate", video.bitrate, 1, 25_000_000);
  }
  if (platform === "tiktok") {
    codec(["h264", "hevc", "vp8", "vp9"]);
    range("frames_per_second", video.fps, 23, 60);
    range("width", video.width, 360, 4096);
    range("height", video.height, 360, 4096);
    range("duration_seconds", video.durationSec, 0.001, 600);
  }
  if (platform === "bluesky") {
    if (media.contentType !== "video/mp4")
      add("video_format_unsupported", "Bluesky videos must contain MP4 data, regardless of filename.");
    range("duration_seconds", video.durationSec, 0.001, 600);
  }
  if (platform === "x") {
    codec(["h264"]);
    audio();
    range("duration_seconds", video.durationSec, 0.5, 7500);
    range("frames_per_second", video.fps, 0.001, 60);
    range("aspect_ratio", ratio, 1 / 3, 3);
    if (video.pixelFormat !== "yuv420p")
      add("pixel_format_unsupported", "X videos must use YUV 4:2:0 (yuv420p). Re-export the video.");
    if (!["1:1", "0:1"].includes(video.sampleAspectRatio))
      add("sample_aspect_ratio_unsupported", "X videos require square pixels.");
    if (video.audioProfile && video.audioProfile !== "LC")
      add("audio_profile_unsupported", "X requires AAC Low Complexity audio.");
  }
  if (platform === "pinterest") {
    codec(["h264", "hevc"]);
    range("duration_seconds", video.durationSec, 4, 900);
  }
  if (platform === "telegram" && media.contentType !== "video/mp4")
    add(
      "video_format_unsupported",
      "Telegram video posts require MP4. Export as MP4 or send the file as a document outside SimplePost.",
    );
  if (platform === "youtube") range("duration_seconds", video.durationSec, 0.001, 43_200);
  // These providers accept multiple encodings. Warn rather than apply ad/Reel limits to organic posts.
  if (["facebook", "linkedin"].includes(platform) && !["h264", "hevc"].includes(video.codec))
    add(
      "video_encoding_recommendation",
      `${platform}: H.264 video with AAC audio is recommended; this encoding's acceptance could not be confirmed.`,
      undefined,
      undefined,
      "warning",
    );
  return issues;
}
