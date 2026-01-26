import fs from "node:fs";

import axios from "axios";
import FormData from "form-data";

import { PostError, PostErrorType } from "../../types";
import { hasValidSource, resolveMediaPath, TempFileManager } from "../../utils";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Media, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";
import type { AxiosInstance } from "axios";

const MAX_TEXT_LENGTH = 4096;
const MAX_CAPTION_LENGTH = 1024;
const MAX_MEDIA_COUNT = 1;

const VALIDATION_RULES: PlatformValidationRules = {
  text: { maxLength: MAX_TEXT_LENGTH, maxCaptionLength: MAX_CAPTION_LENGTH },
  media: { maxCount: MAX_MEDIA_COUNT },
};

export class TelegramPublisher extends Publisher {
  static readonly mediaRequirement = "either" as const; // prefers url but accepts path

  static getValidationRules(): PlatformValidationRules {
    return VALIDATION_RULES;
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
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const text = content.text ?? "";
    const media = content.media ?? [];
    const mediaCount = media.length;

    // Check for empty content
    if (!text.trim() && mediaCount === 0) {
      errors.push({
        platform: "telegram",
        severity: "error",
        code: "content_required",
        message: "Telegram posts require text or media.",
        field: "text",
      });
    }

    // Check text/caption length based on whether media is present
    if (mediaCount > 0) {
      if (text.length > MAX_CAPTION_LENGTH) {
        errors.push({
          platform: "telegram",
          severity: "error",
          code: "caption_too_long",
          message: `Telegram media captions cannot exceed ${MAX_CAPTION_LENGTH} characters.`,
          field: "text",
          limit: MAX_CAPTION_LENGTH,
          actual: text.length,
        });
      }
    } else if (text.length > MAX_TEXT_LENGTH) {
      errors.push({
        platform: "telegram",
        severity: "error",
        code: "text_too_long",
        message: `Telegram messages cannot exceed ${MAX_TEXT_LENGTH} characters.`,
        field: "text",
        limit: MAX_TEXT_LENGTH,
        actual: text.length,
      });
    }

    // Check media sources
    for (const item of media) {
      if (!hasValidSource(item)) {
        errors.push({
          platform: "telegram",
          severity: "error",
          code: "media_source_missing",
          message: "Media must have either a path or url.",
          field: "media",
        });
        break;
      }
    }

    // Warn about excess media
    if (mediaCount > MAX_MEDIA_COUNT) {
      warnings.push({
        platform: "telegram",
        severity: "warning",
        code: "too_many_media",
        message: "Telegram supports only one media item per message. Only the first media will be sent.",
        field: "media",
        limit: MAX_MEDIA_COUNT,
        actual: mediaCount,
      });
    }

    return { errors, warnings, isValid: errors.length === 0 };
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

    // If there's media, send with caption
    if (content.media && content.media.length > 0) {
      const media = content.media[0];

      const { messageId, cleanup } = await this.sendMedia(chatId, media, content.text, parseMode);
      await cleanup();
      return { id: messageId, error: PostErrorType.NO_ERROR };
    }

    // Otherwise send as text message
    const messageId = await this.sendMessage(chatId, content.text!, parseMode);
    return { id: messageId, error: PostErrorType.NO_ERROR };
  }
}
