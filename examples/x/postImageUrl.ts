import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Hey, posting an image from URL!",
      media: [{ type: "image", url: "https://simplepost.dev/simplepost-logo.png" }],
    },
    platforms: ["x"],
  });

  console.log(results);
}

main();
