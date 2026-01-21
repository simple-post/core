import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError, BadRequestError } from "@/lib/utils/errors";

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const body = await req.json();
    const { botToken, chatId, channelName } = body;

    if (!botToken || !chatId) {
      throw new BadRequestError("Bot token and chat ID are required");
    }

    // Validate the bot token and chat ID by making a test API call to Telegram
    try {
      const botInfoResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const botInfo = await botInfoResponse.json();

      if (!botInfoResponse.ok || !botInfo.ok) {
        throw new BadRequestError("Invalid bot token");
      }

      const botUsername = botInfo.result.username;
      const _botId = botInfo.result.id.toString();

      // Try to get chat info to validate chat ID
      const chatInfoResponse = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${chatId}`);
      const chatInfo = await chatInfoResponse.json();

      let chatTitle = channelName;
      let chatUsername = null;

      if (chatInfoResponse.ok && chatInfo.ok) {
        chatTitle = chatInfo.result.title || channelName || chatInfo.result.username || chatId;
        chatUsername = chatInfo.result.username;
      }

      // Store the Telegram account in the database
      // Use chatId as platformAccountId
      await prisma.connectedAccount.upsert({
        where: {
          userId_platform_platformAccountId: {
            userId: session.user.id,
            platform: "telegram",
            platformAccountId: chatId,
          },
        },
        create: {
          userId: session.user.id,
          platform: "telegram",
          platformAccountId: chatId,
          accessToken: botToken, // Store bot token as access token
          refreshToken: null,
          expiresAt: null, // Telegram bot tokens don't expire
          scope: null,
          username: chatUsername ? `@${chatUsername}` : null,
          displayName: chatTitle || `Chat ${chatId}`,
          email: null,
          profilePicture: null,
        },
        update: {
          accessToken: botToken,
          username: chatUsername ? `@${chatUsername}` : null,
          displayName: chatTitle || `Chat ${chatId}`,
          updatedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: true,
        account: {
          platform: "telegram",
          chatId,
          botUsername,
          chatTitle,
        },
      });
    } catch {
      throw new BadRequestError("Failed to validate Telegram credentials. Please check your bot token and chat ID.");
    }
  } catch (error) {
    return handleApiError(error);
  }
}
