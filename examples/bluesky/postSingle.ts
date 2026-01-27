import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Hello Bluesky from SimplePost!",
      media: [{ type: "image", path: "./assets/image_1.jpg" }],
    },
    platforms: ["bluesky"],
  });

  console.log(results);
}

main();
