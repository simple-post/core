import fs from "fs";
import FormData from "form-data";
import axios, { AxiosInstance } from "axios";
import { Content, Media, PostOptions } from "../../types/post";
import { Publisher } from "../base";
import { PostError, PostErrorType, PostResult } from "../../types";

export class TelegramPublisher extends Publisher {
  private client: AxiosInstance;
  private botToken: string;

  constructor(options?: PostOptions) {
    super("Telegram", options);

    this.botToken = process.env.TELEGRAM_BOT_TOKEN || "";

    if (!this.botToken) {
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "TELEGRAM_BOT_TOKEN environment variable is required");
    }

    this.client = axios.create({
      baseURL: `https://api.telegram.org/bot${this.botToken}`,
      timeout: 30000,
    });
  }

  async sendMedia(chatId: string, media: Media, caption?: string, parseMode?: string): Promise<string> {
    if (!fs.existsSync(media.path)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found at path: ${media.path}`);
    }

    try {
      const formData = new FormData();
      formData.append("chat_id", chatId);

      if (media.type === "image") {
        formData.append("photo", fs.createReadStream(media.path));
      } else {
        formData.append("video", fs.createReadStream(media.path));
      }

      if (caption) {
        formData.append("caption", caption);
        if (parseMode) {
          formData.append("parse_mode", parseMode);
        }
      }

      const endpoint = media.type === "image" ? "/sendPhoto" : "/sendVideo";
      const response = await this.client.post(endpoint, formData, {
        headers: {
          ...formData.getHeaders(),
        },
      });

      return response.data.result.message_id.toString();
    } catch (error: any) {
      this.logger.error(error);
      throw new PostError(
        PostErrorType.API_ERROR,
        `Error sending ${media.type}: ${error.response?.data?.description || error.message}`,
        error.response?.data,
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
      this.logger.error(error);
      throw new PostError(
        PostErrorType.API_ERROR,
        `Error sending message: ${error.response?.data?.description || error.message}`,
        error.response?.data,
      );
    }
  }

  validateOptions(options: PostOptions): asserts options is PostOptions & { telegram: { chatId: string } } {
    if (!options.telegram?.chatId) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Telegram chatId is required in options.telegram.chatId");
    }
  }

  validateContent(content: Content): asserts content is (Content & { text: string }) | (Content & { media: Media[] }) {
    if (!content.text && (!content.media || content.media.length === 0)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Empty posts are not supported by Telegram");
    }

    this.strictCheck(
      content.media && content.media.length > 1,
      "Telegram supports only one media per message, only the first media will be sent",
    );
  }

  async postContent(content: Content, options: PostOptions): Promise<PostResult> {
    // Validate the content and the options
    this.validateContent(content);
    this.validateOptions(options);

    const chatId = options.telegram.chatId;
    const parseMode = options.telegram.parseMode;

    // If there's media, send with caption
    if (content.media && content.media.length > 0) {
      const media = content.media[0];

      const messageId = await this.sendMedia(chatId, media, content.text, parseMode);
      return { id: messageId, error: PostErrorType.NO_ERROR };
    }

    // Otherwise send as text message
    const messageId = await this.sendMessage(chatId, content.text!, parseMode);
    return { id: messageId, error: PostErrorType.NO_ERROR };
  }
}
