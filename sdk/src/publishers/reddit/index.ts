import axios from "axios";

import { REDDIT_MAX_TITLE_LENGTH, REDDIT_VALIDATION_RULES, validateRedditContent } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { resolveMediaUrl } from "../../utils";
import { S3MediaUploader } from "../../utils/s3";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";
import type { AxiosInstance } from "axios";

interface RedditSubmitResponse {
  json?: {
    errors?: Array<[string, string, string]>;
    data?: { id?: string; name?: string; url?: string };
  };
}

const TOKEN_BUFFER_SECONDS = 60;

export class RedditPublisher extends Publisher {
  static readonly mediaRequirement = "url" as const;

  static getValidationRules(): PlatformValidationRules {
    return REDDIT_VALIDATION_RULES;
  }

  private client: AxiosInstance;
  private credentials: NonNullable<NonNullable<PostOptionsWithCredentials["reddit"]>["credentials"]>;
  private s3MediaUploader: S3MediaUploader | null = null;
  private s3TempFileKeys: string[] = [];
  private refreshedCredentials: { accessToken: string; expiresAt: number } | null = null;

  constructor(options?: PostOptionsWithCredentials) {
    super("Reddit", options);
    if (!options?.reddit?.credentials) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Reddit credentials are required in options.reddit.credentials",
      );
    }

    this.credentials = options.reddit.credentials;
    this.client = axios.create({
      baseURL: "https://oauth.reddit.com",
      timeout: 30_000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": this.credentials.userAgent || "web:SimplePost:1.0 (https://simplepost.social)",
      },
    });
  }

  static validate(content: Content): ValidationResult {
    return validateRedditContent(content);
  }

  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (
      this.credentials.accessToken &&
      (!this.credentials.expiresAt || this.credentials.expiresAt > now + TOKEN_BUFFER_SECONDS)
    ) {
      return this.credentials.accessToken;
    }

    const { clientId, clientSecret, refreshToken } = this.credentials;
    if (!clientId || !clientSecret || !refreshToken) {
      if (this.credentials.accessToken) return this.credentials.accessToken;
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Reddit access token expired and refresh credentials are missing.",
      );
    }

    try {
      const response = await axios.post(
        "https://www.reddit.com/api/v1/access_token",
        new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
        {
          auth: { username: clientId, password: clientSecret },
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": this.credentials.userAgent || "web:SimplePost:1.0 (https://simplepost.social)",
          },
          timeout: 30_000,
        },
      );
      const accessToken = response.data?.access_token;
      if (!accessToken) throw new Error("Reddit token response did not include access_token");
      const expiresAt = now + (response.data?.expires_in ?? 3600);
      this.credentials.accessToken = accessToken;
      this.credentials.expiresAt = expiresAt;
      this.refreshedCredentials = { accessToken, expiresAt };
      return accessToken;
    } catch (error: unknown) {
      const err = error as { response?: { data?: unknown }; message?: string };
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        `Failed to refresh Reddit credentials: ${err.message || "Unknown error"}`,
        err.response?.data,
      );
    }
  }

  private getS3Uploader(): S3MediaUploader {
    this.s3MediaUploader ??= new S3MediaUploader();
    return this.s3MediaUploader;
  }

  private async cleanupS3Files(): Promise<void> {
    if (this.s3MediaUploader && this.s3TempFileKeys.length > 0) {
      await Promise.all(this.s3TempFileKeys.map((key) => this.s3MediaUploader!.deleteFile(key)));
      this.s3TempFileKeys = [];
    }
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const validation = RedditPublisher.validate(content);
    if (!validation.isValid) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Reddit content validation failed", validation);
    }
    for (const warning of validation.warnings) this.logger.warn(warning.message);

    const reddit = options?.reddit;
    if (!reddit?.subreddit?.trim() || !reddit.title?.trim()) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Reddit subreddit and title are required in options.reddit");
    }
    if (!content.text?.trim() && !reddit.url && !content.media?.length) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Reddit posts require text, a link URL, or one image.");
    }
    if (reddit.title.length > REDDIT_MAX_TITLE_LENGTH) {
      throw new PostError(
        PostErrorType.INVALID_CONTENT,
        `Reddit titles cannot exceed ${REDDIT_MAX_TITLE_LENGTH} characters.`,
      );
    }

    try {
      const media = content.media?.[0];
      let kind: "self" | "link" | "image" = reddit.url ? "link" : "self";
      let submissionUrl = reddit.url;

      if (media?.type === "image") {
        const resolved = await resolveMediaUrl(media, (filePath, key) =>
          this.getS3Uploader().uploadFile(filePath, key),
        );
        submissionUrl = resolved.url;
        if (resolved.uploadedKey) this.s3TempFileKeys.push(resolved.uploadedKey);
        kind = "image";
      }

      const body = new URLSearchParams({
        api_type: "json",
        kind,
        sr: reddit.subreddit.replace(/^r\//, ""),
        title: reddit.title,
        resubmit: "true",
        send_replies: String(reddit.sendReplies ?? true),
      });
      if (kind === "self") body.set("text", content.text ?? "");
      if (submissionUrl) body.set("url", submissionUrl);
      if (reddit.flairId) body.set("flair_id", reddit.flairId);
      if (reddit.flairText) body.set("flair_text", reddit.flairText);
      if (reddit.nsfw) body.set("nsfw", "true");
      if (reddit.spoiler) body.set("spoiler", "true");

      const accessToken = await this.getAccessToken();
      const response = await this.client.post<RedditSubmitResponse>("/api/submit", body, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const errors = response.data?.json?.errors ?? [];
      if (errors.length > 0) {
        throw new PostError(
          PostErrorType.API_ERROR,
          `Reddit rejected the post: ${errors.map(([, message]) => message).join("; ")}`,
          errors,
        );
      }

      const data = response.data?.json?.data;
      const id = data?.id || data?.name?.replace(/^t3_/, "");
      if (!id) throw new PostError(PostErrorType.API_ERROR, "Reddit did not return a post identifier.", response.data);
      return {
        id,
        url: data?.url,
        error: PostErrorType.NO_ERROR,
        ...(this.refreshedCredentials ? { extraData: { refreshedCredentials: this.refreshedCredentials } } : {}),
      };
    } catch (error: unknown) {
      if (error instanceof PostError) throw error;
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to post to Reddit: ${err.response?.data?.message || err.message || "Unknown error"}`,
        err.response?.data,
      );
    } finally {
      await this.cleanupS3Files();
    }
  }
}
