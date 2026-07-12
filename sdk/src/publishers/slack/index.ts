import fs from "node:fs";
import path from "node:path";

import axios from "axios";

import { SLACK_VALIDATION_RULES, validateSlackContent } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { resolveMediaPath, TempFileManager } from "../../utils";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";

interface SlackResponse {
  ok?: boolean;
  error?: string;
}
interface SlackMessageResponse extends SlackResponse {
  channel?: string;
  ts?: string;
}
interface SlackUploadUrlResponse extends SlackResponse {
  upload_url?: string;
  file_id?: string;
}
interface SlackFile {
  id?: string;
  shares?: Record<string, Record<string, Array<{ ts?: string }>>>;
}
interface SlackCompleteUploadResponse extends SlackResponse {
  files?: SlackFile[];
}

function assertSlackResponse<T extends SlackResponse>(response: T, action: string): T {
  if (!response.ok)
    throw new PostError(
      PostErrorType.API_ERROR,
      `Slack ${action} failed: ${response.error || "unknown_error"}`,
      response,
    );
  return response;
}

function findShareTs(file?: SlackFile): string | undefined {
  for (const visibility of Object.values(file?.shares ?? {})) {
    for (const channelShares of Object.values(visibility)) {
      const ts = channelShares[0]?.ts;
      if (ts) return ts;
    }
  }
  return undefined;
}

export class SlackPublisher extends Publisher {
  static readonly mediaRequirement = "path" as const;
  private readonly credentials: NonNullable<NonNullable<PostOptionsWithCredentials["slack"]>["credentials"]>;

  constructor(options?: PostOptionsWithCredentials) {
    super("Slack", options);
    if (!options?.slack?.credentials)
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "Slack credentials are required");
    this.credentials = options.slack.credentials;
  }

  static getValidationRules(): PlatformValidationRules {
    return SLACK_VALIDATION_RULES;
  }
  static validate(content: Content): ValidationResult {
    return validateSlackContent(content);
  }

  private headers(accessToken: string) {
    return {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    };
  }

  private async resolveAccessToken(): Promise<{
    token: string;
    refreshedCredentials?: { accessToken: string; refreshToken?: string; expiresAt?: number };
  }> {
    const expiresSoon = this.credentials.expiresAt && this.credentials.expiresAt <= Math.floor(Date.now() / 1000) + 60;
    if (!expiresSoon) return { token: this.credentials.accessToken };
    if (!this.credentials.refreshToken || !this.credentials.clientId || !this.credentials.clientSecret) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Slack access token expired and refresh credentials are missing",
      );
    }
    const response = await axios.post<
      SlackResponse & { access_token?: string; refresh_token?: string; expires_in?: number }
    >(
      "https://slack.com/api/oauth.v2.access",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.credentials.refreshToken,
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 30_000 },
    );
    const token = assertSlackResponse(response.data, "token refresh");
    if (!token.access_token)
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "Slack token refresh returned no access token");
    const refreshedCredentials = {
      accessToken: token.access_token,
      ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
      ...(token.expires_in ? { expiresAt: Math.floor(Date.now() / 1000) + token.expires_in } : {}),
    };
    return { token: token.access_token, refreshedCredentials };
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const validation = SlackPublisher.validate(content);
    if (!validation.isValid)
      throw new PostError(PostErrorType.INVALID_CONTENT, "Slack content validation failed", validation);
    const slack = options?.slack;
    if (!slack?.channelId) throw new PostError(PostErrorType.INVALID_CONTENT, "Slack channelId is required");

    const tempFiles = new TempFileManager();
    try {
      const { token: accessToken, refreshedCredentials } = await this.resolveAccessToken();
      if (!content.media?.length) {
        const response = await axios.post<SlackMessageResponse>(
          "https://slack.com/api/chat.postMessage",
          {
            channel: slack.channelId,
            text: content.text,
            thread_ts: slack.threadTs,
            reply_broadcast: slack.replyBroadcast,
            unfurl_links: slack.unfurlLinks,
            unfurl_media: slack.unfurlMedia,
            mrkdwn: slack.mrkdwn,
          },
          { headers: this.headers(accessToken), timeout: 30_000 },
        );
        const message = assertSlackResponse(response.data, "message post");
        if (!message.ts) throw new PostError(PostErrorType.API_ERROR, "Slack did not return a message timestamp");
        return {
          id: message.ts,
          error: PostErrorType.NO_ERROR,
          extraData: {
            ...(refreshedCredentials ? { refreshedCredentials } : {}),
            platformData: { channelId: message.channel ?? slack.channelId, ts: message.ts },
          },
        };
      }

      const files: Array<{ id: string; title: string }> = [];
      for (const media of content.media) {
        const resolved = await resolveMediaPath(media);
        tempFiles.add(resolved.cleanup);
        const stat = await fs.promises.stat(resolved.path);
        const filename = path.basename(resolved.path);
        const ticketResponse = await axios.post<SlackUploadUrlResponse>(
          "https://slack.com/api/files.getUploadURLExternal",
          { filename, length: stat.size, alt_txt: media.type === "image" ? media.caption : undefined },
          { headers: this.headers(accessToken), timeout: 30_000 },
        );
        const ticket = assertSlackResponse(ticketResponse.data, "upload URL request");
        if (!ticket.upload_url || !ticket.file_id)
          throw new PostError(PostErrorType.API_ERROR, "Slack did not return a file upload URL");
        await axios.post(ticket.upload_url, fs.createReadStream(resolved.path), {
          headers: { "Content-Type": "application/octet-stream", "Content-Length": stat.size },
          maxBodyLength: Infinity,
          timeout: 60_000,
        });
        files.push({ id: ticket.file_id, title: media.type === "video" ? media.title || filename : filename });
      }

      const completeResponse = await axios.post<SlackCompleteUploadResponse>(
        "https://slack.com/api/files.completeUploadExternal",
        { files, channel_id: slack.channelId, initial_comment: content.text || undefined, thread_ts: slack.threadTs },
        { headers: this.headers(accessToken), timeout: 60_000 },
      );
      const complete = assertSlackResponse(completeResponse.data, "file upload completion");
      const firstFile = complete.files?.[0];
      const id = findShareTs(firstFile) ?? firstFile?.id;
      if (!id) throw new PostError(PostErrorType.API_ERROR, "Slack did not return a file or message identifier");
      return {
        id,
        error: PostErrorType.NO_ERROR,
        extraData: {
          ...(refreshedCredentials ? { refreshedCredentials } : {}),
          platformData: { channelId: slack.channelId, fileIds: complete.files?.map((file) => file.id).filter(Boolean) },
        },
      };
    } catch (error: unknown) {
      if (error instanceof PostError) throw error;
      const err = error as { response?: { data?: { error?: string } }; message?: string };
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to post to Slack: ${err.response?.data?.error || err.message || "Unknown error"}`,
        err.response?.data,
      );
    } finally {
      await tempFiles.cleanup();
    }
  }
}
