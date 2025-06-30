import dotenv from "dotenv";
import { post } from "unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Here's a cool video to share!",
      media: [
        {
          type: "video",
          path: "./telegram/data/1.mp4",
        },
      ],
      options: {
        telegramSpecific: {
          chatId: "YOUR_CHAT_ID", // Replace with your actual chat ID
        },
      },
    },
    platforms: ["telegram"],
  });

  console.log(results);
}

main();
