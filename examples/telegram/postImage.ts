import dotenv from "dotenv";
import { post } from "unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Check out this amazing image!",
      media: [
        {
          type: "image",
          path: "./assets/image_1.jpg",
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
