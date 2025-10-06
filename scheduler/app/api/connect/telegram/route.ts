import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/repositories/prisma";

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { botToken, chatId, channelName } = body;

    if (!botToken || !chatId) {
      return NextResponse.json({ error: "Bot token and chat ID are required" }, { status: 400 });
    }

    // Validate the bot token and chat ID by making a test API call to Telegram
    try {
      const botInfoResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const botInfo = await botInfoResponse.json();

      if (!botInfoResponse.ok || !botInfo.ok) {
        return NextResponse.json({ error: "Invalid bot token" }, { status: 400 });
      }

      const botUsername = botInfo.result.username;
      const botId = botInfo.result.id.toString();

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
    } catch (error) {
      console.error("Telegram API error:", error);
      return NextResponse.json(
        { error: "Failed to validate Telegram credentials. Please check your bot token and chat ID." },
        { status: 400 },
      );
    }
  } catch (error) {
    console.error("Error connecting Telegram account:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
