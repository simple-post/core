import fs from "node:fs";

import axios from "axios";
import FormData from "form-data";

import { TELEGRAM_VALIDATION_RULES, validateTelegramContent } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { resolveMediaPath, TempFileManager } from "../../utils";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Media, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";
import type { AxiosInstance } from "axios";

export class TelegramPublisher extends Publisher {
  static readonly mediaRequirement = "either" as const; // prefers url but accepts path

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
      timeout: 30_000,
    });
  }

  private async sendMedia(
    chatId: string,
    media: Media,
    caption?: string,
    parseMode?: string,
    replyTo?: string,
  ): Promise<{ messageId: string; cleanup: () => Promise<void> }> {
    const tempFileManager = new TempFileManager();

    try {
      const endpoint = media.type === "image" ? "/sendPhoto" : "/sendVideo";
      const mediaField = media.type === "image" ? "photo" : "video";

      // Telegram API can accept URLs directly - no need to download
      if (media.url) {
        const payload: Record<string, unknown> = {
          chat_id: chatId,
          [mediaField]: media.url,
        };

        if (caption) {
          payload.caption = caption;
          if (parseMode) {
            payload.parse_mode = parseMode;
          }
        }

        if (replyTo) {
          payload.reply_to_message_id = Number.parseInt(replyTo);
        }

        const response = await this.client.post(endpoint, payload);
        return { messageId: response.data.result.message_id.toString(), cleanup: async () => {} };
      }

      // For file path, use FormData upload
      const { path: resolvedPath, cleanup } = await resolveMediaPath(media);
      tempFileManager.add(cleanup);

      if (!fs.existsSync(resolvedPath)) {
        throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found at path: ${resolvedPath}`);
      }

      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append(mediaField, fs.createReadStream(resolvedPath));

      if (caption) {
        formData.append("caption", caption);
        if (parseMode) {
          formData.append("parse_mode", parseMode);
        }
      }

      if (replyTo) {
        formData.append("reply_to_message_id", replyTo);
      }

      const response = await this.client.post(endpoint, formData, {
        headers: {
          ...formData.getHeaders(),
        },
      });

      return { messageId: response.data.result.message_id.toString(), cleanup: () => tempFileManager.cleanup() };
    } catch (error: unknown) {
      const err = error as { response?: { data?: { description?: string } }; message?: string };
      await tempFileManager.cleanup();
      this.logger.error(error instanceof Error ? error : String(error));
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to send ${media.type}: ${err.response?.data?.description || err.message || "Unknown error"}`,
        err.response?.data,
      );
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
    const parseMode = options.telegram.parseMode;
    const replyTo = options.telegram.replyTo;

    // If there's media, send with caption
    if (content.media && content.media.length > 0) {
      const media = content.media[0];

      const { messageId, cleanup } = await this.sendMedia(chatId, media, content.text, parseMode, replyTo);
      await cleanup();
      return { id: messageId, error: PostErrorType.NO_ERROR };
    }

    // Otherwise send as text message
    const messageId = await this.sendMessage(chatId, content.text!, parseMode, replyTo);
    return { id: messageId, error: PostErrorType.NO_ERROR };
  }
}
