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

      // Try to get chat info to validate chat ID and resolve username to numeric ID
      const chatInfoResponse = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${chatId}`);
      const chatInfo = await chatInfoResponse.json();

      if (!chatInfoResponse.ok || !chatInfo.ok) {
        throw new BadRequestError(
          "Could not find the chat. Make sure the bot is added to the channel/group, or use the numeric chat ID (you can get it from @userinfobot).",
        );
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
        create: {
          userId: session.user.id,
          platform: "telegram",
          platformAccountId: numericChatId,
          accessToken: botToken, // Store bot token as access token
          refreshToken: null,
          expiresAt: null, // Telegram bot tokens don't expire
          scope: null,
          username: chatUsername ? `@${chatUsername}` : null,
          displayName: chatTitle || `Chat ${numericChatId}`,
          email: null,
          profilePicture: null,
        },
        update: {
          accessToken: botToken,
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
    } catch {
      throw new BadRequestError("Failed to validate Telegram credentials. Please check your bot token and chat ID.");
    }
  } catch (error) {
    return handleApiError(error);
  }
}
