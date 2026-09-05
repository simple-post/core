import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import axios from "axios";

import { BLUESKY_MAX_VIDEO_SIZE_BYTES } from "./validation";

import { PostError, PostErrorType } from "../../types";

export interface VideoBlob {
  $type: string;
  ref: { $link: string };
  mimeType: string;
  size: number;
}

interface VideoJob {
  jobId: string;
  state: string;
  blob?: VideoBlob;
  error?: string;
  message?: string;
  failureCode?: string;
}

type VideoResponse = VideoJob | { jobStatus: VideoJob };

const VIDEO_SERVICE = "https://video.bsky.app/xrpc/app.bsky.video";
const PROCESSING_TIMEOUT_MS = 300_000;

function jobFrom(data: unknown): VideoJob {
  if (!data || typeof data !== "object") {
    throw new PostError(PostErrorType.API_ERROR, "Bluesky returned an invalid video processing response.");
  }
  const job = "jobStatus" in data ? data.jobStatus : data;
  if (!job || typeof job !== "object") {
    throw new PostError(PostErrorType.API_ERROR, "Bluesky returned an invalid video processing job.");
  }
  return job as VideoJob;
}

function existingJob(error: unknown): VideoJob | undefined {
  const data = (error as { response?: { data?: unknown } }).response?.data;
  if (!data || typeof data !== "object") return undefined;
  const job = jobFrom(data);
  return job.blob || job.error === "already_exists" || ("error" in data && data.error === "already_exists")
    ? job
    : undefined;
}

/** Stream to Bluesky's processor; publish only once it has stored the finished blob on the PDS. */
export async function uploadBlueskyVideo(
  resolvedPath: string,
  did: string,
  getServiceToken: () => Promise<string>,
): Promise<VideoBlob> {
  if (!fs.existsSync(resolvedPath)) {
    throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found: ${resolvedPath}`);
  }
  const size = fs.statSync(resolvedPath).size;
  if (size === 0 || size > BLUESKY_MAX_VIDEO_SIZE_BYTES) {
    throw new PostError(
      PostErrorType.INVALID_CONTENT,
      "Bluesky videos must be nonempty and cannot exceed 300,000,000 bytes (300 MB).",
    );
  }
  if (!/\.(mp4|m4v)$/i.test(resolvedPath)) {
    throw new PostError(PostErrorType.INVALID_CONTENT, "Bluesky videos must be MP4 files.");
  }

  try {
    const token = await getServiceToken();
    const stream = fs.createReadStream(resolvedPath);
    let job: VideoJob;
    try {
      const response = await axios.post<VideoResponse>(`${VIDEO_SERVICE}.uploadVideo`, stream, {
        params: { did, name: path.basename(resolvedPath) },
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4", "Content-Length": String(size) },
        timeout: 120_000,
        maxBodyLength: BLUESKY_MAX_VIDEO_SIZE_BYTES,
        maxRedirects: 0,
      });
      job = jobFrom(response.data);
    } catch (error) {
      // Duplicate uploads can return a non-2xx response containing the existing job/blob.
      const existing = existingJob(error);
      if (!existing) throw error;
      job = existing;
    } finally {
      stream.destroy();
    }

    const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
    while (true) {
      // An already-processed video may carry both an error and a usable blob.
      if (job.blob) return job.blob;
      if (job.state === "JOB_STATE_FAILED" || (job.error && job.error !== "already_exists")) {
        throw new PostError(
          PostErrorType.API_ERROR,
          `Bluesky video processing failed: ${job.message || job.failureCode || job.error || job.state}`,
        );
      }
      if (!job.jobId || job.state === "JOB_STATE_COMPLETED") {
        throw new PostError(PostErrorType.API_ERROR, "Bluesky video processing returned no video blob or usable job.");
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new PostError(
          PostErrorType.API_ERROR,
          "Bluesky video processing timed out after 5 minutes. Try publishing again.",
        );
      }
      await delay(Math.min(2000, remaining));
      if (Date.now() >= deadline) continue;
      try {
        const response = await axios.get<{ jobStatus: VideoJob }>(`${VIDEO_SERVICE}.getJobStatus`, {
          params: { jobId: job.jobId },
          timeout: Math.min(30_000, deadline - Date.now()),
        });
        job = jobFrom(response.data);
      } catch (error) {
        const existing = existingJob(error);
        if (!existing) throw error;
        job = existing;
      }
    }
  } catch (error) {
    if (error instanceof PostError) throw error;
    const err = error as { response?: { data?: { message?: string; error?: string } }; message?: string };
    throw new PostError(
      PostErrorType.API_ERROR,
      `Failed to upload Bluesky video: ${err.response?.data?.message || err.response?.data?.error || err.message || "Unknown error"}. Check that your Bluesky email is verified and your video upload quota is available.`,
    );
  }
}
