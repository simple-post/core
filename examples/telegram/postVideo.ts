import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Here's a cool video to share!",
      media: [
        {
          type: "video",
          path: "./assets/video_1.mp4",
        },
      ],
    },
    platforms: ["telegram"],
    options: {
      telegram: {
        chatId: process.env.TELEGRAM_CHAT_ID!,
      },
    },
  });

  console.log(results);
}

main();
