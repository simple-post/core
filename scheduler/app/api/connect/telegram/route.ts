import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { encryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import { handleApiError, BadRequestError } from "@/lib/utils/errors";

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const body = await req.json();
    const { botToken, chatId, channelName } = body;
    const trimmedToken = typeof botToken === "string" ? botToken.trim() : "";
    const trimmedChatId = typeof chatId === "string" ? chatId.trim() : "";

    if (!trimmedToken || !trimmedChatId) {
      throw new BadRequestError("Bot token and chat ID are required");
    }

    // Validate the bot token and chat ID by making a test API call to Telegram
    try {
      const botInfoResponse = await fetch(`https://api.telegram.org/bot${trimmedToken}/getMe`);
      const botInfo = await botInfoResponse.json();

      if (!botInfoResponse.ok || !botInfo.ok) {
        const msg = botInfo?.description || "Invalid bot token";
        throw new BadRequestError(msg);
      }

      const botUsername = botInfo.result.username;

      // Try to get chat info to validate chat ID and resolve username to numeric ID
      const encodedChatId = encodeURIComponent(trimmedChatId);
      const chatInfoResponse = await fetch(
        `https://api.telegram.org/bot${trimmedToken}/getChat?chat_id=${encodedChatId}`,
      );
      const chatInfo = await chatInfoResponse.json();

      if (!chatInfoResponse.ok || !chatInfo.ok) {
        const apiMsg = chatInfo?.description;
        const isLikelyUser = /^\d+$/.test(trimmedChatId) && Number.parseInt(trimmedChatId, 10) > 0;
        const hint = isLikelyUser
          ? "For direct messages, the user must message the bot with /start first before you can connect."
          : "Could not find the chat. Make sure the bot is added as an admin to the channel/group, or use the numeric chat ID (you can get it from @userinfobot).";
        throw new BadRequestError(apiMsg ? `${apiMsg} ${hint}` : hint);
      }

      // Extract the numeric chat ID from the API response (works for usernames like @channel)
      const numericChatId = chatInfo.result.id.toString();
      const chatTitle = chatInfo.result.title || channelName || chatInfo.result.username || numericChatId;
      const chatUsername = chatInfo.result.username || null;

      // Store the Telegram account in the database
      // Use numeric chat ID as platformAccountId (required for posting)
      await prisma.connectedAccount.upsert({
        where: {
          userId_platform_platformAccountId: {
            userId: session.user.id,
            platform: "telegram",
            platformAccountId: numericChatId,
          },
        },
        create: encryptConnectedAccountSecrets({
          userId: session.user.id,
          platform: "telegram",
          platformAccountId: numericChatId,
          accessToken: trimmedToken, // Store bot token as access token
          refreshToken: null,
          expiresAt: null, // Telegram bot tokens don't expire
          scope: null,
          username: chatUsername ? `@${chatUsername}` : null,
          displayName: chatTitle || `Chat ${numericChatId}`,
          email: null,
          profilePicture: null,
        }),
        update: {
          ...encryptConnectedAccountSecrets({ accessToken: trimmedToken, refreshToken: null }),
          username: chatUsername ? `@${chatUsername}` : null,
          displayName: chatTitle || `Chat ${numericChatId}`,
          updatedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: true,
        account: {
          platform: "telegram",
          chatId: numericChatId,
          botUsername,
          chatTitle,
        },
      });
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      // Log unexpected errors (network, DB, etc.) for debugging
      console.error("Telegram connect error:", error);
      throw new BadRequestError(
        "Failed to validate Telegram credentials. Please check your bot token and chat ID. The bot must be added as an admin to the channel/group.",
      );
    }
  } catch (error) {
    return handleApiError(error);
  }
}
