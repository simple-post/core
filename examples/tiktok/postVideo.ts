import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Check out this awesome video! 🎥✨ #viral #fyp #trending",
      media: [
        {
          type: "video",
          path: "./assets/video_vertical.mp4",
          title: "My Amazing TikTok Video",
          description: "A fun and engaging video for TikTok!",
        },
      ],
    },
    platforms: ["tiktok"],
    options: {
      tiktok: {
        // Publish immediately to public (default behavior)
        publishMode: "public", // or "draft" to save as draft
        visibility: "public", // "public", "friends", or "private"
        allowComment: true, // Allow users to comment
        allowDuet: true, // Allow users to duet with this video
        allowStitch: true, // Allow users to stitch this video
      },
    },
  });

  console.log("TikTok Video Post Results:", results);
}

main().catch((error) => {
  console.error("Error posting to TikTok:", error);
  process.exit(1);
});
