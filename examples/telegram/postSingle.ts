import dotenv from "dotenv";
import { post } from "unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Hey, this is a test message sent to Telegram!",
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
