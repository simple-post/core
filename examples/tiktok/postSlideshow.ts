import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Amazing memories captured! 📸 #memories #photooftheday #aesthetic",
      media: [
        {
          type: "image",
          path: "./assets/image_1.jpg",
          caption: "Beautiful moment captured in time",
        },
        {
          type: "image",
          path: "./assets/image_2.jpg",
          caption: "Beautiful moment captured in time",
        },
        {
          type: "image",
          path: "./assets/image_3.jpg",
          caption: "Beautiful moment captured in time",
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
        // Note: TikTok only uses the first image for photo posts
      },
    },
  });

  console.log("TikTok Photo Post Results:", results);
}

main().catch((error) => {
  console.error("Error posting photo to TikTok:", error);
  process.exit(1);
});
