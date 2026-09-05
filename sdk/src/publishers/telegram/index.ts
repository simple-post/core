import fs from "node:fs";
import path from "node:path";

import axios from "axios";
import FormData from "form-data";

import {
  TELEGRAM_VALIDATION_RULES,
  TELEGRAM_MAX_UPLOAD_PHOTO_SIZE_BYTES,
  TELEGRAM_MAX_UPLOAD_VIDEO_SIZE_BYTES,
  validateTelegramContent,
} from "./validation";

import { PostError, PostErrorType } from "../../types";
import { resolveMediaPath, TempFileManager } from "../../utils";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Media, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";
import type { AxiosInstance } from "axios";

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
    super("Telegram", options);

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

  private async sendMedia(
    chatId: string,
    mediaItems: Media[],
    caption?: string,
    parseMode?: string,
    replyTo?: string,
  ): Promise<string> {
    const tempFileManager = new TempFileManager();
    const streams: fs.ReadStream[] = [];
    const isAlbum = mediaItems.length > 1;

    try {
      const formData = new FormData();
      formData.append("chat_id", chatId);
      const album: { type: string; media: string; caption?: string; parse_mode?: string }[] = [];

      for (const [index, media] of mediaItems.entries()) {
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

        const sourceFilename = (() => {
          if (!media.url) return path.basename(resolvedPath);
          try {
            return path.basename(new URL(media.url).pathname) || path.basename(resolvedPath);
          } catch {
            return path.basename(resolvedPath);
          }
        })();
        const mediaType = media.type === "image" ? "photo" : "video";
        const mediaField = isAlbum ? `media_${index}` : mediaType;
        const stream = fs.createReadStream(resolvedPath);
        streams.push(stream);
        formData.append(mediaField, stream, { filename: sourceFilename });

        if (isAlbum) {
          album.push({
            type: mediaType,
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

      const singleMediaEndpoint = mediaItems[0].type === "image" ? "/sendPhoto" : "/sendVideo";
      const endpoint = isAlbum ? "/sendMediaGroup" : singleMediaEndpoint;
      const response = await this.client.post(endpoint, formData, {
        headers: {
          ...formData.getHeaders(),
        },
      });

      // Use the first album message as the post ID for links and thread replies.
      const message = isAlbum ? response.data.result[0] : response.data.result;
      return message.message_id.toString();
    } catch (error: unknown) {
      if (error instanceof PostError) {
        throw error;
      }
      const err = error as { response?: { data?: { description?: string } }; message?: string };
      this.logger.error(error instanceof Error ? error : String(error));
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to send ${isAlbum ? "media group" : mediaItems[0].type}: ${err.response?.data?.description || err.message || "Unknown error"}`,
        err.response?.data,
      );
    } finally {
      for (const stream of streams) {
        stream.destroy();
      }
      await tempFileManager.cleanup();
    }
  }

  private async sendMessage(chatId: string, text: string, parseMode?: string, replyTo?: string): Promise<string> {
    try {
      const payload: Record<string, unknown> = {
        chat_id: chatId,
        text: text,
        parse_mode: parseMode || "HTML",
      };

      if (replyTo) {
        payload.reply_to_message_id = Number.parseInt(replyTo);
      }

      const response = await this.client.post("/sendMessage", payload);

      return response.data.result.message_id.toString();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { description?: string } }; message?: string };
      this.logger.error(error instanceof Error ? error : String(error));
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to send message: ${err.response?.data?.description || err.message || "Unknown error"}`,
        err.response?.data,
      );
    }
  }

  private validateOptions(
    options: PostOptionsWithCredentials,
  ): asserts options is PostOptionsWithCredentials & { telegram: { chatId: string } } {
    if (!options.telegram?.chatId) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Telegram chatId is required in options.telegram.chatId");
    }
  }

  static validate(content: Content): ValidationResult {
    return validateTelegramContent(content);
  }

  async postContent(content: Content, options: PostOptionsWithCredentials): Promise<PostResult> {
    // Validate the content and the options
    const validation = TelegramPublisher.validate(content);
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
