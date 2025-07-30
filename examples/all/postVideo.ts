import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Hey, posting video",
      media: [{ type: "video", path: "./assets/video_1.mp4", title: "This is a video title" }],
    },
    platforms: ["x", "telegram", "youtube", "facebook", "instagram"],
    options: {
      common: {
        logLevel: "info",
        strictMode: false,
      },
      telegram: {
        chatId: process.env.TELEGRAM_CHAT_ID!,
      },
    },
  });

  console.log(results);
}

main();
