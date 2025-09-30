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
        // Save as draft for review before publishing
        publishMode: "draft", // or "public" to publish immediately
        visibility: "public", // "public", "friends", or "private"
        allowComment: true, // Allow users to comment
        allowDuet: false, // Disable duets for photo posts
        allowStitch: false, // Disable stitching for photo posts
      },
    },
  });

  console.log("TikTok Photo Post Results:", results);
}

main().catch((error) => {
  console.error("Error posting photo to TikTok:", error);
  process.exit(1);
});
