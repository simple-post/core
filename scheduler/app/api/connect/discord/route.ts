import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";
import { handleApiError, BadRequestError } from "@/lib/utils/errors";

interface DiscordWebhook {
  id?: string;
  name?: string | null;
  channel_id?: string | null;
  guild_id?: string | null;
  avatar?: string | null;
}

function normalizeWebhookUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestError("Webhook URL is required");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new BadRequestError("Provide a valid Discord incoming webhook URL");
  }
  if (
    url.protocol !== "https:" ||
    // discordapp.com and the ptb/canary hosts still issue valid webhook URLs.
    !/^(?:www\.|ptb\.|canary\.)?discord(?:app)?\.com$/.test(url.hostname) ||
    !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname)
  ) {
    throw new BadRequestError("Provide a valid Discord incoming webhook URL");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    const body = await request.json();
    const webhookUrl = normalizeWebhookUrl(body.webhookUrl);
    const response = await fetch(webhookUrl, { signal: AbortSignal.timeout(15_000) });
    const webhook = (await response.json().catch(() => ({}))) as DiscordWebhook & { message?: string };
    if (!response.ok || !webhook.id) throw new BadRequestError(webhook.message || "Discord rejected this webhook URL");
    const avatar = webhook.avatar ? `https://cdn.discordapp.com/avatars/${webhook.id}/${webhook.avatar}.png` : null;
    await upsertConnectedAccount({
      userId: session.user.id,
      platform: "discord",
      platformAccountId: webhook.id,
      accessToken: webhookUrl,
      refreshToken: null,
      expiresAt: null,
      scope: null,
      username: null,
      displayName: webhook.name || "Discord webhook",
      email: null,
      profilePicture: avatar,
      tokenMetadata: { channelId: webhook.channel_id, guildId: webhook.guild_id },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
