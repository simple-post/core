import dotenv from "dotenv";
import { post } from "unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: [
      {
        text: "This is the first message in our Telegram thread",
        options: {
          telegramSpecific: {
            chatId: "YOUR_CHAT_ID", // Replace with your actual chat ID
          },
        },
      },
      {
        text: "This is the second message, replying to the first",
        options: {
          telegramSpecific: {
            chatId: "YOUR_CHAT_ID", // Replace with your actual chat ID
          },
        },
      },
      {
        text: "And this is the third message in the sequence",
        options: {
          telegramSpecific: {
            chatId: "YOUR_CHAT_ID", // Replace with your actual chat ID
          },
        },
      },
    ],
    platforms: ["telegram"],
  });

  console.log(results);
}

main();
