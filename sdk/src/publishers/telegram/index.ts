import fs from "node:fs";
import path from "node:path";

import axios from "axios";
import FormData from "form-data";

import {
  TELEGRAM_VALIDATION_RULES,
  TELEGRAM_MAX_UPLOAD_PHOTO_SIZE_BYTES,
  TELEGRAM_MAX_UPLOAD_VIDEO_SIZE_BYTES,
} from "./validation";

import { PostError, PostErrorType } from "../../types";
import { resolveMediaPath, TempFileManager } from "../../utils";
import { withTransientRetry } from "../../utils/transient-retry";
import { validateContentForPlatform } from "../../validation";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { PostOptions, Content, Media, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";
import type { AxiosInstance } from "axios";

// Flood-control waits longer than this are surfaced to the caller instead of
// blocking the publish; the shared utility never shortens a provider wait.
const MAX_FLOOD_WAIT_MS = 30_000;

/** Telegram Bot API error envelope. Only this structured shape is treated as the bot's own rejection. */
interface TelegramErrorBody {
  ok: false;
  error_code: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

interface TelegramRejection {
  status: number;
  body: TelegramErrorBody;
}

interface PreparedTelegramFile {
  path: string;
  filename: string;
  type: "photo" | "video";
}

/**
 * Returns Telegram's structured rejection when the response is the Bot API's
 * own JSON envelope with a matching HTTP status. Proxy or HTML error pages,
 * transport failures and 5xx responses do not qualify.
 */
function telegramRejection(error: unknown): TelegramRejection | undefined {
  const response = (error as { response?: { status?: unknown; data?: unknown } } | undefined)?.response;
  const body = response?.data as Partial<TelegramErrorBody> | undefined;
  if (!body || typeof body !== "object" || body.ok !== false || typeof body.error_code !== "number") return undefined;
  if (typeof response?.status !== "number" || response.status !== body.error_code) return undefined;
  if (body.error_code >= 500) return undefined;
  return { status: response.status, body: body as TelegramErrorBody };
}

/** Explicit flood control: the bot rejected the call before sending anything and told us when to retry. */
function isTelegramFloodControl(error: unknown): boolean {
  const rejection = telegramRejection(error);
  const retryAfter = rejection?.body.parameters?.retry_after;
  return rejection?.status === 429 && typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter >= 0;
}

export class TelegramPublisher extends Publisher {
  // Telegram's URL-fetch limits are lower and its fetch errors are opaque.
  // Always prepare a local path and upload with multipart/form-data instead.
  static readonly mediaRequirement = "path" as const;

  static getValidationRules(): PlatformValidationRules {
    return TELEGRAM_VALIDATION_RULES;
  }

  private client: AxiosInstance;
  private botToken: string;

  constructor(options?: PostOptionsWithCredentials) {
    super("Telegram", options, "telegram");

    // Validate the credentials
    if (!options?.telegram?.credentials) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Telegram credentials are required in options.telegram.credentials",
      );
    }

    this.botToken = options.telegram.credentials.botToken;

    this.client = axios.create({
      baseURL: `https://api.telegram.org/bot${this.botToken}`,
      timeout: 120_000,
    });
  }

  /** Removes the bot token and any bot URL from text that ends up in errors or logs. */
  private redact(text: string): string {
    return text
      .split(this.botToken || "\0")
      .join("[redacted]")
      .replaceAll(/https?:\/\/[^\s<>"']+/gi, "[redacted URL]")
      .replaceAll(/bot\d+:[\w-]+/g, "bot[redacted]");
  }

  /**
   * Sending is publication. Only Telegram's explicit flood-control rejection is
   * retried automatically (at most twice, waiting no longer than 30 seconds);
   * network timeouts and 5xx responses may already have delivered the message
   * and are never resent. Other structured rejections are classified by the
   * Bot API contract; anything else stays an uncertain API_ERROR.
   */
  private async send<T>(method: string, request: () => Promise<{ data: T }>, failurePrefix: string): Promise<T> {
    try {
      const response = await withTransientRetry(request, {
        shouldRetry: isTelegramFloodControl,
        maxDelayMs: MAX_FLOOD_WAIT_MS,
      });
      return response.data;
    } catch (error: unknown) {
      if (error instanceof PostError) throw error;
      throw this.classifyFailure(error, method, failurePrefix);
    }
  }

  /** Keeps only the Bot API envelope fields; never the Axios config/request, which carry the bot URL. */
  private safeResponseBody(data: unknown): Record<string, unknown> {
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const body = data as Partial<TelegramErrorBody>;
    const retryAfter = body.parameters?.retry_after;
    const migrateTo = body.parameters?.migrate_to_chat_id;
    return {
      ...(typeof body.ok === "boolean" && { ok: body.ok }),
      ...(typeof body.error_code === "number" && { error_code: body.error_code }),
      ...(typeof body.description === "string" && { description: this.redact(body.description) }),
      ...((typeof retryAfter === "number" || typeof migrateTo === "number") && {
        parameters: {
          ...(typeof retryAfter === "number" && { retry_after: retryAfter }),
          ...(typeof migrateTo === "number" && { migrate_to_chat_id: migrateTo }),
        },
      }),
    };
  }

  private classifyFailure(error: unknown, method: string, failurePrefix: string): PostError {
    const err = error as { response?: { status?: unknown; data?: unknown }; message?: unknown };
    const rejection = telegramRejection(error);
    const body = this.safeResponseBody(err.response?.data);
    const description = typeof body.description === "string" ? body.description : undefined;
    const reason = description ?? (typeof err.message === "string" ? this.redact(err.message) : "Unknown error");
    const retryAfter = rejection?.body.parameters?.retry_after;
    const details = {
      ...(typeof err.response?.status === "number" && { httpStatus: err.response.status }),
      ...body,
      ...(rejection?.status === 429 && typeof retryAfter === "number" && { method, retryAfter }),
    };
    this.logger.error(`${failurePrefix}: ${reason}`);

    if (rejection?.status === 429) {
      const wait = typeof retryAfter === "number" ? ` Telegram asks to wait ${retryAfter} seconds.` : "";
      return new PostError(
        PostErrorType.RATE_LIMIT_ERROR,
        `${failurePrefix}: Telegram flood control rejected the request.${wait} Nothing was sent; retry later.`,
        details,
      );
    }
    if (rejection?.status === 401) {
      return new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        `${failurePrefix}: Telegram rejected the bot token. Reconnect the Telegram bot in account settings.`,
        details,
      );
    }
    if (rejection?.status === 400 || rejection?.status === 403) {
      return new PostError(PostErrorType.PUBLISH_REJECTED, `${failurePrefix}: ${reason}`, details);
    }
    return new PostError(PostErrorType.API_ERROR, `${failurePrefix}: ${reason}`, details);
  }

  private async prepareMediaFile(media: Media, tempFileManager: TempFileManager): Promise<PreparedTelegramFile> {
    // URL-backed media is downloaded by resolveMediaPath. Sending the
    // resulting file as multipart raises Telegram's photo/video limits to
    // 10/50 MiB and avoids Telegram's fragile server-side URL fetch.
    const { path: resolvedPath, cleanup } = await resolveMediaPath(media);
    tempFileManager.add(cleanup);

    if (!fs.existsSync(resolvedPath)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found at path: ${resolvedPath}`);
    }

    const actualSize = fs.statSync(resolvedPath).size;
    const maxSize =
      media.type === "image" ? TELEGRAM_MAX_UPLOAD_PHOTO_SIZE_BYTES : TELEGRAM_MAX_UPLOAD_VIDEO_SIZE_BYTES;
    if (actualSize > maxSize) {
      throw new PostError(
        PostErrorType.INVALID_CONTENT,
        `Telegram ${media.type}s cannot exceed ${maxSize / (1024 * 1024)} MB.`,
        { limit: maxSize, actual: actualSize },
      );
    }

    const filename = (() => {
      if (!media.url) return path.basename(resolvedPath);
      try {
        return path.basename(new URL(media.url).pathname) || path.basename(resolvedPath);
      } catch {
        return path.basename(resolvedPath);
      }
    })();

    return { path: resolvedPath, filename, type: media.type === "image" ? "photo" : "video" };
  }

  private async sendMedia(
    chatId: string,
    mediaItems: Media[],
    caption?: string,
    parseMode?: string,
    replyTo?: string,
  ): Promise<string> {
    const tempFileManager = new TempFileManager();
    const isAlbum = mediaItems.length > 1;
    const singleMediaEndpoint = mediaItems[0].type === "image" ? "/sendPhoto" : "/sendVideo";
    const endpoint = isAlbum ? "/sendMediaGroup" : singleMediaEndpoint;
    // Local files are prepared once and kept until sending is finished, so a
    // flood-control retry reuses them without downloading again.
    const prepared: (PreparedTelegramFile | undefined)[] = [];

    // A multipart body can only be streamed once. Every attempt builds a fresh
    // form with fresh file streams and destroys them when the attempt ends.
    const attempt = async () => {
      const streams: fs.ReadStream[] = [];
      try {
        const formData = new FormData();
        formData.append("chat_id", chatId);
        const album: { type: string; media: string; caption?: string; parse_mode?: string }[] = [];

        for (const [index, media] of mediaItems.entries()) {
          // Nothing has been sent while files are still being prepared, so a
          // download failure here is a safe-to-retry preparation error.
          const file =
            prepared[index] ??
            (await this.prepareMediaFile(media, tempFileManager).catch((error: unknown) => {
              if (error instanceof PostError && error.errorType !== PostErrorType.API_ERROR) throw error;
              throw new PostError(
                PostErrorType.PREPARATION_ERROR,
                `Failed to prepare Telegram ${media.type}. Nothing was sent.`,
                { stage: "prepare_media" },
              );
            }));
          prepared[index] = file;

          const mediaField = isAlbum ? `media_${index}` : file.type;
          const stream = fs.createReadStream(file.path);
          streams.push(stream);
          formData.append(mediaField, stream, { filename: file.filename });

          if (isAlbum) {
            album.push({
              type: file.type,
              media: `attach://${mediaField}`,
              ...(index === 0 && caption ? { caption, ...(parseMode ? { parse_mode: parseMode } : {}) } : {}),
            });
          }
        }

        if (isAlbum) {
          formData.append("media", JSON.stringify(album));
        } else if (caption) {
          formData.append("caption", caption);
          if (parseMode) {
            formData.append("parse_mode", parseMode);
          }
        }

        if (replyTo) {
          formData.append("reply_parameters", JSON.stringify({ message_id: Number.parseInt(replyTo) }));
        }

        return await this.client.post(endpoint, formData, {
          headers: {
            ...formData.getHeaders(),
          },
        });
      } finally {
        for (const stream of streams) {
          stream.destroy();
        }
      }
    };

    try {
      const data = await this.send<{ result: { message_id: number } | { message_id: number }[] }>(
        endpoint.slice(1),
        attempt,
        `Failed to send ${isAlbum ? "media group" : mediaItems[0].type}`,
      );

      // Use the first album message as the post ID for links and thread replies.
      const message = Array.isArray(data.result) ? data.result[0] : data.result;
      return message.message_id.toString();
    } finally {
      await tempFileManager.cleanup();
    }
  }

  private async sendMessage(chatId: string, text: string, parseMode?: string, replyTo?: string): Promise<string> {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: text,
      parse_mode: parseMode || "HTML",
    };

    if (replyTo) {
      payload.reply_to_message_id = Number.parseInt(replyTo);
    }

    const data = await this.send<{ result: { message_id: number } }>(
      "sendMessage",
      () => this.client.post("/sendMessage", payload),
      "Failed to send message",
    );

    return data.result.message_id.toString();
  }

  private validateOptions(
    options: PostOptionsWithCredentials,
  ): asserts options is PostOptionsWithCredentials & { telegram: { chatId: string } } {
    if (!options.telegram?.chatId) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Telegram chatId is required in options.telegram.chatId");
    }
  }

  static validate(content: Content, options?: PostOptions["telegram"]): ValidationResult {
    return validateContentForPlatform("telegram", content, { telegram: options });
  }

  async postContent(content: Content, options: PostOptionsWithCredentials): Promise<PostResult> {
    // Validate the content and the options
    const validation = TelegramPublisher.validate(content, options?.telegram);
    if (!validation.isValid) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Telegram content validation failed", validation);
    }
    for (const warning of validation.warnings) {
      this.logger.warn(warning.message);
    }
    this.validateOptions(options);

    const chatId = options.telegram.chatId;
    const botId = this.botToken.match(/^(\d+):/)?.[1];
    if (botId && String(chatId).trim() === botId) {
      throw new PostError(
        PostErrorType.INVALID_CONTENT,
        "Telegram bots cannot post to themselves. Reconnect using your own numeric user ID after sending /start to the bot, or use a channel/group where the bot is an admin.",
      );
    }
    const parseMode = options.telegram.parseMode;
    const replyTo = options.telegram.replyTo;

    // If there's media, send with caption
    if (content.media && content.media.length > 0) {
      const messageId = await this.sendMedia(chatId, content.media, content.text, parseMode, replyTo);
      return { id: messageId, error: PostErrorType.NO_ERROR };
    }

    // Otherwise send as text message
    const messageId = await this.sendMessage(chatId, content.text!, parseMode, replyTo);
    return { id: messageId, error: PostErrorType.NO_ERROR };
  }
}
