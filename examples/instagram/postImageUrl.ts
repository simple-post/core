import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Beautiful image from URL! 🌅 #simplepost #automation",
      media: [{ type: "image", url: "https://simplepost.dev/simplepost-logo.png" }],
    },
    platforms: ["instagram"],
  });

  console.log(results);
}

main();
