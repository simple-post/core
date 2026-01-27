import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const boardId = process.env.PINTEREST_BOARD_ID;
  if (!boardId) {
    throw new Error("PINTEREST_BOARD_ID is required");
  }

  const results = await post({
    content: {
      text: "A short description for this pin.",
      media: [{ type: "image", path: "./assets/image_4.jpg" }],
    },
    platforms: ["pinterest"],
    options: {
      pinterest: {
        boardId,
        title: "SimplePost Pinterest Pin",
        link: "https://example.com",
        altText: "A scenic photo for the pin",
      },
    },
  });

  console.log(results);
}

main();
