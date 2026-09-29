import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

import axios from "axios";

import { PostError, PostErrorType } from "../../types";
import { getContentType, resolveMediaPath, TempFileManager } from "../../utils";

import type { PostResult } from "../../types";
import type { Content, Media } from "../../types/post";
import type { AxiosRequestConfig } from "axios";

const API = "https://api.linkedin.com/rest";
const VERSION = "202606";

// Posts API commentary uses LinkedIn's `little` markup. Treat user content as
// text so punctuation cannot become a malformed mention or truncate a post.
export function escapeLinkedInText(text: string): string {
  return text.replaceAll(/[|{}@[\]()<>#\\*_~]/g, String.raw`\$&`);
}

async function waitForMedia(kind: "images" | "videos", id: string, config: AxiosRequestConfig): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt++) {
    const { data } = await axios.get(`${API}/${kind}/${encodeURIComponent(id)}`, config);
    if (data.status === "AVAILABLE") return;
    if (data.status === "PROCESSING_FAILED" || data.status === "FAILED") {
      throw new Error(`LinkedIn ${kind} processing failed. Check the media format and try again.`);
    }
    await delay(2000);
  }
  throw new Error("LinkedIn media processing timed out. No post was created.");
}

function validateUploadUrl(value: string): void {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !(url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com") || url.hostname.endsWith(".licdn.com"))
  ) {
    throw new Error("LinkedIn returned an unsupported media upload URL");
  }
}

async function uploadPart(path: string, url: string, accessToken: string, firstByte: number, lastByte: number) {
  validateUploadUrl(url);
  const stream = fs.createReadStream(path, { start: firstByte, end: lastByte });
  try {
    return await axios.put(url, stream, {
      timeout: 600_000,
      maxRedirects: 0,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": getContentType(path),
        "Content-Length": lastByte - firstByte + 1,
      },
    });
  } finally {
    stream.destroy();
  }
}

async function uploadPageMedia(
  media: Media,
  path: string,
  author: string,
  accessToken: string,
  config: AxiosRequestConfig,
): Promise<string> {
  const size = fs.statSync(path).size;
  if (size === 0) throw new Error("Cannot upload empty LinkedIn media");
  if (media.type === "image") {
    const { data } = await axios.post(
      `${API}/images?action=initializeUpload`,
      { initializeUploadRequest: { owner: author } },
      config,
    );
    const { image, uploadUrl } = data.value ?? {};
    if (!image || !uploadUrl) throw new Error("LinkedIn did not return image upload information");
    await uploadPart(path, uploadUrl, accessToken, 0, size - 1);
    await waitForMedia("images", image, config);
    return image;
  }

  const { data } = await axios.post(
    `${API}/videos?action=initializeUpload`,
    {
      initializeUploadRequest: { owner: author, fileSizeBytes: size, uploadCaptions: false, uploadThumbnail: false },
    },
    config,
  );
  const { video, uploadToken, uploadInstructions } = (data.value ?? {}) as {
    video?: string;
    uploadToken?: string;
    uploadInstructions?: Array<{ uploadUrl: string; firstByte: number; lastByte: number }>;
  };
  if (!video || typeof uploadToken !== "string" || !uploadInstructions?.length)
    throw new Error("LinkedIn did not return video upload information");
  let expectedStart = 0;
  // Validate the complete byte range before uploading any part.
  for (const part of uploadInstructions) {
    if (
      !Number.isSafeInteger(part.firstByte) ||
      !Number.isSafeInteger(part.lastByte) ||
      part.firstByte !== expectedStart ||
      part.lastByte < part.firstByte ||
      part.lastByte >= size
    ) {
      throw new Error("LinkedIn returned invalid video upload ranges");
    }
    expectedStart = part.lastByte + 1;
  }
  if (expectedStart !== size) throw new Error("LinkedIn video upload ranges do not cover the entire file");
  const uploadedPartIds: string[] = [];
  for (const part of uploadInstructions) {
    const response = await uploadPart(path, part.uploadUrl, accessToken, part.firstByte, part.lastByte);
    const etag = response.headers.etag;
    if (typeof etag !== "string" || !etag) throw new Error("LinkedIn did not return a video upload ETag");
    uploadedPartIds.push(etag.replaceAll(/^"|"$/g, ""));
  }
  await axios.post(
    `${API}/videos?action=finalizeUpload`,
    { finalizeUploadRequest: { video, uploadToken, uploadedPartIds } },
    config,
  );
  await waitForMedia("videos", video, config);
  return video;
}

export async function publishLinkedInPage(accessToken: string, author: string, content: Content): Promise<PostResult> {
  const config: AxiosRequestConfig = {
    timeout: 30_000,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Linkedin-Version": VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
    },
  };
  const temporary = new TempFileManager();
  try {
    const uploaded: Array<{ id: string; altText?: string; title?: string }> = [];
    for (const media of content.media ?? []) {
      const { path, cleanup } = await resolveMediaPath(media);
      temporary.add(cleanup);
      const id = await uploadPageMedia(media, path, author, accessToken, config);
      uploaded.push({
        id,
        ...(media.type === "image" && media.caption ? { altText: media.caption } : {}),
        ...(media.type === "video" ? { title: media.title || "Video" } : {}),
      });
    }
    let postContent: Record<string, unknown> | undefined;
    if (uploaded.length > 1) postContent = { multiImage: { images: uploaded } };
    else if (uploaded.length === 1) postContent = { media: uploaded[0] };
    const response = await axios.post(
      `${API}/posts`,
      {
        author,
        commentary: escapeLinkedInText(content.text ?? ""),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
        ...(postContent ? { content: postContent } : {}),
      },
      config,
    );
    const id = response.data?.id || response.headers?.["x-restli-id"];
    if (!id) throw new Error("LinkedIn did not return a post ID. Check the Page before retrying.");
    return { id, error: PostErrorType.NO_ERROR };
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    let message = error instanceof Error ? error.message : "Unknown error";
    if (status === 401 || status === 403) {
      message =
        "LinkedIn Page access expired or publishing permission was removed. Reconnect with a Page admin account.";
    }
    throw new PostError(PostErrorType.API_ERROR, `Failed to publish to LinkedIn Page: ${message}`);
  } finally {
    await temporary.cleanup();
  }
}
