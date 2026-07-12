import fs from "node:fs";
import path from "node:path";

import axios from "axios";
import FormData from "form-data";

import { DISCORD_VALIDATION_RULES, validateDiscordContent } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { getContentType, resolveMediaPath, TempFileManager } from "../../utils";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";

interface DiscordMessage {
  id?: string;
  channel_id?: string;
  guild_id?: string;
}

export function normalizeDiscordWebhookUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PostError(PostErrorType.CREDENTIALS_ERROR, "Discord webhook URL is invalid.");
  }
  if (url.protocol !== "https:" || !["discord.com", "www.discord.com"].includes(url.hostname)) {
    throw new PostError(PostErrorType.CREDENTIALS_ERROR, "Discord webhook URL must use https://discord.com.");
  }
  if (!/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]+$/.test(url.pathname.replace(/\/$/, ""))) {
    throw new PostError(PostErrorType.CREDENTIALS_ERROR, "Discord webhook URL has an invalid path.");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString();
}

export class DiscordPublisher extends Publisher {
  static readonly mediaRequirement = "path" as const;

  static getValidationRules(): PlatformValidationRules {
    return DISCORD_VALIDATION_RULES;
  }

  private webhookUrl: string;

  constructor(options?: PostOptionsWithCredentials) {
    super("Discord", options);
    if (!options?.discord?.credentials) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Discord credentials are required in options.discord.credentials",
      );
    }
    this.webhookUrl = normalizeDiscordWebhookUrl(options.discord.credentials.webhookUrl);
  }

  static validate(content: Content): ValidationResult {
    return validateDiscordContent(content);
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const validation = DiscordPublisher.validate(content);
    if (!validation.isValid)
      throw new PostError(PostErrorType.INVALID_CONTENT, "Discord content validation failed", validation);

    const discord = options?.discord;
    const flags = (discord?.suppressEmbeds ? 1 << 2 : 0) | (discord?.suppressNotifications ? 1 << 12 : 0);
    const payload: Record<string, unknown> = {
      content: content.text || undefined,
      username: discord?.username || undefined,
      avatar_url: discord?.avatarUrl || undefined,
      flags: flags || undefined,
      allowed_mentions: discord?.allowMentions ? undefined : { parse: [] },
    };
    const url = new URL(this.webhookUrl);
    url.searchParams.set("wait", "true");
    if (discord?.threadId) url.searchParams.set("thread_id", discord.threadId);

    const tempFiles = new TempFileManager();
    try {
      let response;
      if (content.media?.length) {
        const form = new FormData();
        const attachments: Array<{ id: number; filename: string; description?: string }> = [];
        for (const [index, media] of content.media.entries()) {
          const resolved = await resolveMediaPath(media);
          tempFiles.add(resolved.cleanup);
          const filename = path.basename(resolved.path);
          form.append(`files[${index}]`, fs.createReadStream(resolved.path), {
            filename,
            contentType: getContentType(resolved.path),
          });
          const description = media.type === "image" ? media.caption : media.description;
          attachments.push({ id: index, filename, ...(description ? { description } : {}) });
        }
        form.append("payload_json", JSON.stringify({ ...payload, attachments }));
        response = await axios.post<DiscordMessage>(url.toString(), form, {
          headers: form.getHeaders(),
          timeout: 60_000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        });
      } else {
        response = await axios.post<DiscordMessage>(url.toString(), payload, { timeout: 30_000 });
      }
      const message = response.data;
      if (!message.id) throw new PostError(PostErrorType.API_ERROR, "Discord did not return a message ID.");
      const messageUrl = message.channel_id
        ? `https://discord.com/channels/${message.guild_id || "@me"}/${message.channel_id}/${message.id}`
        : undefined;
      return {
        id: message.id,
        url: messageUrl,
        error: PostErrorType.NO_ERROR,
        extraData: { platformData: { channelId: message.channel_id, guildId: message.guild_id } },
      };
    } catch (error: unknown) {
      if (error instanceof PostError) throw error;
      const err = error as { response?: { data?: { message?: string } }; message?: string };
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to post to Discord: ${err.response?.data?.message || err.message || "Unknown error"}`,
        err.response?.data,
      );
    } finally {
      await tempFiles.cleanup();
    }
  }
}
