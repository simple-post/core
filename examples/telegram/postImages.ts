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
          path: "./telegram/data/1.jpg",
        },
      ],
    },
    platforms: ["telegram"],
    options: {
      telegram: {
        chatId: "YOUR_CHAT_ID", // Replace with your actual chat ID
      },
    },
  });

  console.log(results);
}

main();
