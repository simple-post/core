import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Check out this amazing image from URL!",
      media: [
        {
          type: "image",
          url: "https://simplepost.dev/simplepost-logo.png",
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
