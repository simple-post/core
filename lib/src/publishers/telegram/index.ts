import { Content, Media, PostOptions } from "../../types/post";
import { PostError, Publisher } from "../../types/publisher";
import { PostErrorType, PostResult } from "../../types";
import axios, { AxiosInstance } from "axios";
import fs from "fs";
import FormData from "form-data";

export class TelegramPublisher extends Publisher {
  private client: AxiosInstance;
  private botToken: string;

  constructor() {
    super();

    this.botToken = process.env.TELEGRAM_BOT_TOKEN || "";

    if (!this.botToken) {
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "TELEGRAM_BOT_TOKEN environment variable is required");
    }

    this.client = axios.create({
      baseURL: `https://api.telegram.org/bot${this.botToken}`,
      timeout: 30000,
    });
  }

  async sendPhoto(chatId: string, media: Media, caption?: string, parseMode?: string): Promise<string> {
    if (!media.path) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Media path is required for photos");
    }

    if (!fs.existsSync(media.path)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, `Photo file not found at path: ${media.path}`);
    }

    try {
      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append("photo", fs.createReadStream(media.path));

      if (caption) {
        formData.append("caption", caption);
        formData.append("parse_mode", parseMode || "HTML");
      }

      const response = await this.client.post("/sendPhoto", formData, {
        headers: {
          ...formData.getHeaders(),
        },
      });

      return response.data.result.message_id.toString();
    } catch (error: any) {
      throw new PostError(
        PostErrorType.API_ERROR,
        `Error sending photo: ${error.response?.data?.description || error.message}`,
        error.response?.data
      );
    }
  }

  async sendVideo(chatId: string, media: Media, caption?: string, parseMode?: string): Promise<string> {
    if (!media.path) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Media path is required for videos");
    }

    if (!fs.existsSync(media.path)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, `Video file not found at path: ${media.path}`);
    }

    try {
      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append("video", fs.createReadStream(media.path));

      if (caption) {
        formData.append("caption", caption);
        formData.append("parse_mode", parseMode || "HTML");
      }

      const response = await this.client.post("/sendVideo", formData, {
        headers: {
          ...formData.getHeaders(),
        },
      });

      return response.data.result.message_id.toString();
    } catch (error: any) {
      throw new PostError(
        PostErrorType.API_ERROR,
        `Error sending video: ${error.response?.data?.description || error.message}`,
        error.response?.data
      );
    }
  }

  async sendMessage(chatId: string, text: string, parseMode?: string, replyTo?: string): Promise<string> {
    try {
      const payload: any = {
        chat_id: chatId,
        text: text,
        parse_mode: parseMode || "HTML",
      };

      if (replyTo) {
        payload.reply_to_message_id = parseInt(replyTo);
      }

      const response = await this.client.post("/sendMessage", payload);
      return response.data.result.message_id.toString();
    } catch (error: any) {
      throw new PostError(
        PostErrorType.API_ERROR,
        `Error sending message: ${error.response?.data?.description || error.message}`,
        error.response?.data
      );
    }
  }

  async postContent(content: Content, chatId: string, parseMode?: string): Promise<string> {
    // Check for empty content
    if (!content.text && !content.media) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported by Telegram");
    }

    // If there's media, send with caption
    if (content.media && content.media.length > 0) {
      const media = content.media[0]; // Telegram handles one media per message

      if (media.type === "image") {
        return await this.sendPhoto(chatId, media, content.text, parseMode);
      } else if (media.type === "video") {
        return await this.sendVideo(chatId, media, content.text, parseMode);
      } else {
        throw new PostError(PostErrorType.INVALID_CONTENT, `Unsupported media type: ${(media as any).type}`);
      }
    }

    // Otherwise send as text message
    if (content.text) {
      return await this.sendMessage(chatId, content.text, parseMode);
    }

    throw new PostError(PostErrorType.INVALID_CONTENT, "No valid content to send");
  }

  async post(content: Content, options: PostOptions): Promise<PostResult[]> {
    try {
      // Check for telegram-specific options
      if (!options.telegram?.chatId) {
        throw new PostError(PostErrorType.INVALID_CONTENT, "Telegram chatId is required in options.telegram.chatId");
      }

      const chatId = options.telegram.chatId;
      const parseMode = options.telegram.parseMode;

      const messageId = await this.postContent(content, chatId, parseMode);

      return [
        {
          id: messageId,
          error: PostErrorType.NO_ERROR,
        },
      ];
    } catch (error: any) {
      if (error instanceof PostError) {
        return [
          {
            error: error.errorType,
            message: error.message,
            details: error.details,
          },
        ];
      } else {
        return [
          {
            error: PostErrorType.OTHER,
            message: `Error posting to Telegram: ${error.message}`,
            details: error,
          },
        ];
      }
    }
  }
}
