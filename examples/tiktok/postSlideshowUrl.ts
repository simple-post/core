import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Amazing image from URL! 📸 #simplepost #automation",
      media: [
        {
          type: "image",
          url: "https://simplepost.social/simplepost-logo.png",
          caption: "SimplePost logo loaded from URL",
        },
      ],
    },
    platforms: ["tiktok"],
    options: {
      tiktok: {
        // Choose publish mode:
        // "public" - publishes immediately to TikTok
        // "draft" - uploads to inbox for later review
        publishMode: "draft", // or "public" for immediate publishing

        // The following options only apply when publishMode is "public":
        // NOTE: For unaudited apps, use visibility: "private"
        visibility: "private", // "public", "friends", or "private"
        allowComment: true, // Allow users to comment
      },
    },
  });

  console.log("TikTok Photo Post Results:", results);
}

main().catch((error) => {
  console.error("Error posting photo to TikTok:", error);
  process.exit(1);
});
