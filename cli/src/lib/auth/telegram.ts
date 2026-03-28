import crypto from "node:crypto";

import { fetchJson } from "./oauth.js";
import { resolveStoredAccountAlias } from "./oauth.js";
import { getAccountPlatformConfig } from "../account/platforms.js";

import type { AuthProvider, AuthProviderContext } from "./provider.js";
import type { CliConfigV1, OAuthAccountSecretPayload } from "../types.js";
import type { AccountPlatform } from "../account/platforms.js";

interface TelegramBotInfo {
  ok: boolean;
  result?: { username?: string };
  description?: string;
}

interface TelegramChatInfo {
  ok: boolean;
  result?: { id: number; title?: string; username?: string };
  description?: string;
}

async function validateTelegramCredentials(
  botToken: string,
  chatId: string,
): Promise<{ numericChatId: string; chatTitle: string; chatUsername: string | null }> {
  const botInfo = await fetchJson<TelegramBotInfo>(
    `https://api.telegram.org/bot${botToken}/getMe`,
    { method: "GET" },
    "Telegram bot validation",
  );

  if (!botInfo.ok || !botInfo.result) {
    throw new Error(botInfo.description ?? "Invalid bot token.");
  }

  const encodedChatId = encodeURIComponent(chatId);
  const chatInfo = await fetchJson<TelegramChatInfo>(
    `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodedChatId}`,
    { method: "GET" },
    "Telegram chat validation",
  );

  if (!chatInfo.ok || !chatInfo.result) {
    const isLikelyUser = /^\d+$/.test(chatId) && Number.parseInt(chatId, 10) > 0;
    const hint = isLikelyUser
      ? "For direct messages, the user must message the bot with /start first before you can connect."
      : "Could not find the chat. Make sure the bot is added as an admin to the channel/group, or use the numeric chat ID (you can get it from @userinfobot).";
    throw new Error(`${chatInfo.description ?? "Invalid chat ID"} ${hint}`);
  }

  const numericChatId = chatInfo.result.id.toString();
  const chatTitle = chatInfo.result.title ?? chatInfo.result.username ?? numericChatId;
  const chatUsername = chatInfo.result.username ? `@${chatInfo.result.username}` : null;

  return { numericChatId, chatTitle, chatUsername };
}

export interface TelegramLoginFlags {
  alias?: string;
  botToken?: string;
  chatId?: string;
}

export class TelegramAuthProvider implements AuthProvider<TelegramLoginFlags> {
  public readonly platform = "telegram" as AccountPlatform;

  public async login(flags: TelegramLoginFlags, context: AuthProviderContext): Promise<CliConfigV1> {
    const { config, prompt, secretStore } = context;

    const botToken =
      flags.botToken?.trim() ??
      (prompt.interactive ? await prompt.secret("Bot token") : undefined);
    const chatId =
      flags.chatId?.trim() ??
      (prompt.interactive ? await prompt.text("Chat ID (numeric ID or @channel)", { required: true }) : undefined);

    if (!botToken || !chatId) {
      throw new Error('Bot token and chat ID are required. Use --bot-token and --chat-id in non-interactive mode.');
    }

    const { numericChatId, chatTitle, chatUsername } = await validateTelegramCredentials(botToken, chatId);

    const alias = await resolveStoredAccountAlias(
      prompt,
      config.telegram.accounts,
      this.platform,
      numericChatId,
      chatUsername ?? chatTitle,
      flags.alias,
    );

    const existingAccount = config.telegram.accounts.find((account) => account.userId === numericChatId);
    const now = new Date().toISOString();
    const secretRef =
      existingAccount?.secretRef ?? `telegram-account-${crypto.randomUUID()}`;

    const updatedAccounts = config.telegram.accounts.filter((account) => account.userId !== numericChatId);
    updatedAccounts.push({
      alias,
      connectedAt: existingAccount?.connectedAt ?? now,
      displayName: chatTitle,
      secretRef,
      updatedAt: now,
      userId: numericChatId,
      ...(chatUsername ? { username: chatUsername } : {}),
    });
    updatedAccounts.sort((left, right) => left.alias.localeCompare(right.alias));

    const secretPayload: OAuthAccountSecretPayload = {
      accessToken: botToken,
      tokenMetadata: { chatId: numericChatId },
    };

    await secretStore.write(secretRef, secretPayload);

    const handle = chatUsername ? ` ${chatUsername}` : "";
    prompt.log(`Connected ${getAccountPlatformConfig(this.platform).displayName} account "${alias}"${handle}.`);

    return {
      ...config,
      telegram: {
        accounts: updatedAccounts,
      },
    };
  }
}
