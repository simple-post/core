import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Check out this amazing image from URL! 📸",
      media: [{ type: "image", url: "https://simplepost.social/simplepost-logo.png" }],
    },
    platforms: ["facebook"],
  });

  console.log(results);
}

main();
