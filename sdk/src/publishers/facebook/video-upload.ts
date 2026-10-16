import fs from "node:fs";
import path from "node:path";

import FormData from "form-data";

import { PostError, PostErrorType } from "../../types";

import type { AxiosInstance } from "axios";

const MAX_CHUNK_BYTES = 64 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 120_000;
const TOTAL_UPLOAD_TIMEOUT_MS = 10 * 60_000;
const PROCESSING_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 3000;

type Stage = "start" | "transfer" | "finish" | "url" | "processing";
type UploadResponse = {
  id?: string;
  video_id?: string;
  upload_session_id?: string;
  start_offset?: string;
  end_offset?: string;
  success?: boolean;
};

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[\w-]{1,200}$/.test(value);
}

function offsets(data: UploadResponse, size: number, expectedStart: number): [number, number] {
  const start = Number(data.start_offset);
  const end = Number(data.end_offset);
  if (
    data.start_offset === undefined ||
    data.end_offset === undefined ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start !== expectedStart ||
    end < start ||
    end > size ||
    end - start > MAX_CHUNK_BYTES ||
    (end === start && start !== size)
  ) {
    throw new PostError(PostErrorType.PREPARATION_ERROR, "Facebook returned invalid video upload offsets.");
  }
  return [start, end];
}

/** URL ingestion and bounded-memory Page video uploads, using the same Page token as ordinary posts. */
export class FacebookVideoUpload {
  constructor(
    private readonly client: AxiosInstance,
    private readonly pageId: string,
    private readonly accessToken: string,
    private readonly checkCredentials: (error: unknown) => void,
  ) {}

  async publish(input: {
    filePath: string;
    fileUrl?: string;
    title?: string;
    description?: string;
    publishAt?: string;
  }): Promise<string> {
    const endpoint = `/${this.pageId}/videos`;
    const metadata: Record<string, string> = {};
    if (input.title) metadata.title = input.title;
    if (input.description) metadata.description = input.description;
    if (input.publishAt) {
      metadata.scheduled_publish_time = String(Math.floor(new Date(input.publishAt).getTime() / 1000));
      metadata.published = "false";
    }
    let stage: Stage = input.fileUrl ? "url" : "start";
    let videoId: string | undefined;
    const uploadDeadline = Date.now() + TOTAL_UPLOAD_TIMEOUT_MS;
    const uploadTimeout = () => {
      const remaining = uploadDeadline - Date.now();
      if (remaining <= 0) throw new Error("Video upload deadline exceeded");
      return Math.min(UPLOAD_TIMEOUT_MS, remaining);
    };
    try {
      if (input.fileUrl) {
        const { data } = await this.client.post<UploadResponse>(
          endpoint,
          new URLSearchParams({ ...metadata, access_token: this.accessToken, file_url: input.fileUrl }),
          { timeout: uploadTimeout() },
        );
        if (!identifier(data.id)) throw new Error("Missing video ID");
        videoId = data.id;
      } else {
        const size = fs.statSync(input.filePath).size;
        if (!Number.isSafeInteger(size) || size <= 0)
          throw new PostError(PostErrorType.INVALID_CONTENT, "Facebook requires a nonempty video file.");
        const { data } = await this.client.post<UploadResponse>(
          endpoint,
          new URLSearchParams({ access_token: this.accessToken, upload_phase: "start", file_size: String(size) }),
          { timeout: uploadTimeout() },
        );
        if (!identifier(data.video_id) || !identifier(data.upload_session_id))
          throw new Error("Missing upload session");
        videoId = data.video_id;
        const sessionId = data.upload_session_id;
        let [start, end] = offsets(data, size, 0);
        stage = "transfer";
        // Meta chooses the chunk boundaries. Never send the full file or load it into memory.
        while (start < size) {
          const stream = fs.createReadStream(input.filePath, { start, end: end - 1 });
          try {
            const form = new FormData();
            form.append("access_token", this.accessToken);
            form.append("upload_phase", "transfer");
            form.append("upload_session_id", sessionId);
            form.append("start_offset", String(start));
            form.append("video_file_chunk", stream, {
              filename: path.basename(input.filePath),
              contentType: "application/octet-stream",
              knownLength: end - start,
            });
            const response = await this.client.post<UploadResponse>(endpoint, form, {
              headers: form.getHeaders(),
              maxBodyLength: MAX_CHUNK_BYTES + 1024 * 1024,
              timeout: uploadTimeout(),
            });
            [start, end] = offsets(response.data, size, end);
          } finally {
            stream.destroy();
          }
        }
        // Check the overall deadline before entering the ambiguous publish phase.
        const finishTimeout = uploadTimeout();
        stage = "finish";
        const response = await this.client.post<UploadResponse>(
          endpoint,
          new URLSearchParams({
            ...metadata,
            access_token: this.accessToken,
            upload_phase: "finish",
            upload_session_id: sessionId,
          }),
          { timeout: finishTimeout },
        );
        if (response.data.success !== true) throw new Error("Missing upload confirmation");
      }
      stage = "processing";
      await this.waitUntilReady(videoId);
      return videoId;
    } catch (error) {
      // A failure reading status must never turn an accepted video into a safely retryable publish.
      if (stage !== "processing") this.checkCredentials(error);
      if (error instanceof PostError && stage !== "processing") throw error;
      const err = error as {
        response?: {
          status?: number;
          data?: { error?: { code?: number; error_subcode?: number; fbtrace_id?: string } };
        };
      };
      const status = err.response?.status;
      const provider = err.response?.data?.error;
      const beforePublish = stage === "start" || stage === "transfer";
      const rejected = beforePublish || (stage !== "processing" && status === 413);
      let message = "Facebook did not confirm video publication. Check the video before retrying.";
      if (stage === "processing")
        message =
          "Facebook accepted the video, but its processing result could not be confirmed. Check the video before retrying.";
      else if (status === 413) message = "Facebook rejected the video upload because the request was too large.";
      else if (beforePublish) message = "Facebook video upload failed before publication. It is safe to retry.";
      // Never attach an Axios error: it contains the Page token and multipart request body.
      throw new PostError(rejected ? PostErrorType.PUBLISH_REJECTED : PostErrorType.API_ERROR, message, {
        stage,
        ...(videoId && { videoId }),
        ...(typeof status === "number" && { httpStatus: status }),
        ...(typeof provider?.code === "number" && { code: provider.code }),
        ...(typeof provider?.error_subcode === "number" && { subcode: provider.error_subcode }),
        ...(identifier(provider?.fbtrace_id) && { traceId: provider.fbtrace_id }),
      });
    }
  }

  private async waitUntilReady(videoId: string): Promise<void> {
    const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const response = await this.client.get<{ status?: { video_status?: string } }>(`/${videoId}`, {
        params: { fields: "status" },
        headers: { Authorization: `Bearer ${this.accessToken}` },
        timeout: Math.min(30_000, deadline - Date.now()),
      });
      const status = response.data.status?.video_status;
      if (status === "ready") return;
      if (status !== "processing" && status !== "uploading") throw new Error("Video did not become ready");
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()))),
      );
    }
    throw new Error("Video processing timed out");
  }
}
