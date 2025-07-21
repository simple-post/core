import dotenv from "dotenv";
import { post } from "@unsubpost/unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Hey, this is a test message sent to Telegram!",
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
