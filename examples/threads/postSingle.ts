import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Hello Threads! 👋",
      media: [{ type: "image", path: "./assets/image_2.jpg" }],
    },
    platforms: ["threads"],
  });

  console.log(results);
}

main();
