import crypto from "node:crypto";
import fs from "node:fs";

import axios from "axios";
import FormData from "form-data";

import { MASTODON_VALIDATION_RULES, validateMastodonContent } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { getContentType, resolveMediaPath, TempFileManager } from "../../utils";
import { Publisher } from "../base";

import type { PostResult, RepostResult } from "../../types";
import type { Content, PostOptionsWithCredentials, RepostTarget } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";
import type { AxiosInstance } from "axios";

interface MastodonMediaAttachment {
  id: string;
  url?: string | null;
}

interface MastodonStatus {
  id: string;
  url?: string | null;
}

const MEDIA_POLL_INTERVAL_MS = 500;
const MEDIA_POLL_ATTEMPTS = 60;

function normalizeInstanceUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new PostError(PostErrorType.CREDENTIALS_ERROR, "Mastodon instanceUrl must use HTTPS.");
  }
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export class MastodonPublisher extends Publisher {
  static readonly mediaRequirement = "path" as const;

  static getValidationRules(): PlatformValidationRules {
    return MASTODON_VALIDATION_RULES;
  }

  private client: AxiosInstance;

  constructor(options?: PostOptionsWithCredentials) {
    super("Mastodon", options);
    if (!options?.mastodon?.credentials) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Mastodon credentials are required in options.mastodon.credentials",
      );
    }
    const instanceUrl = normalizeInstanceUrl(options.mastodon.credentials.instanceUrl);
    this.client = axios.create({
      baseURL: instanceUrl,
      timeout: 60_000,
      headers: { Authorization: `Bearer ${options.mastodon.credentials.accessToken}` },
    });
  }

  static validate(content: Content): ValidationResult {
    return validateMastodonContent(content);
  }

  private async waitForMedia(id: string): Promise<void> {
    for (let attempt = 0; attempt < MEDIA_POLL_ATTEMPTS; attempt += 1) {
      const response = await this.client.get<MastodonMediaAttachment>(`/api/v1/media/${id}`);
      if (response.data.url) return;
      await new Promise((resolve) => setTimeout(resolve, MEDIA_POLL_INTERVAL_MS));
    }
    throw new PostError(PostErrorType.API_ERROR, "Mastodon media processing timed out.");
  }

  private async uploadMedia(path: string, description?: string): Promise<string> {
    if (!fs.existsSync(path)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found: ${path}`);
    }
    const form = new FormData();
    form.append("file", fs.createReadStream(path), { contentType: getContentType(path) });
    if (description) form.append("description", description);

    const response = await this.client.post<MastodonMediaAttachment>("/api/v2/media", form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    if (!response.data.id) throw new PostError(PostErrorType.API_ERROR, "Mastodon did not return a media ID.");
    if (!response.data.url) await this.waitForMedia(response.data.id);
    return response.data.id;
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const validation = MastodonPublisher.validate(content);
    if (!validation.isValid) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Mastodon content validation failed", validation);
    }

    const tempFiles = new TempFileManager();
    try {
      const mediaIds: string[] = [];
      for (const media of content.media ?? []) {
        const { path, cleanup } = await resolveMediaPath(media);
        tempFiles.add(cleanup);
        const description = media.type === "image" ? media.caption : media.description;
        mediaIds.push(await this.uploadMedia(path, description));
      }

      const mastodon = options?.mastodon;
      const payload: Record<string, unknown> = {
        status: content.text ?? "",
        media_ids: mediaIds.length > 0 ? mediaIds : undefined,
        visibility: mastodon?.visibility ?? "public",
        spoiler_text: mastodon?.spoilerText || undefined,
        sensitive: mastodon?.sensitive ?? false,
        language: mastodon?.language || undefined,
        in_reply_to_id: mastodon?.inReplyToId || undefined,
      };
      const response = await this.client.post<MastodonStatus>("/api/v1/statuses", payload, {
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      return { id: response.data.id, url: response.data.url || undefined, error: PostErrorType.NO_ERROR };
    } catch (error: unknown) {
      if (error instanceof PostError) throw error;
      const err = error as { response?: { data?: { error?: string } }; message?: string };
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to post to Mastodon: ${err.response?.data?.error || err.message || "Unknown error"}`,
        err.response?.data,
      );
    } finally {
      await tempFiles.cleanup();
    }
  }

  protected async repostContent(target: RepostTarget): Promise<RepostResult> {
    try {
      const response = await this.client.post<MastodonStatus>(`/api/v1/statuses/${target.postId}/reblog`);
      return { id: response.data.id, url: response.data.url || undefined, error: PostErrorType.NO_ERROR };
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } }; message?: string };
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to boost on Mastodon: ${err.response?.data?.error || err.message || "Unknown error"}`,
        err.response?.data,
      );
    }
  }
}
