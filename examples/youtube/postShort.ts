import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      media: [
        {
          type: "video",
          path: "./assets/video_vertical.mp4",
          title: "Test short",
          description: "This is a test short",
          thumbnailPath: "./assets/video_vertical_thumbnail.jpg",
        },
      ],
    },
    platforms: ["youtube"],
    options: {
      youtube: {
        privacyStatus: "unlisted",
      },
    },
  });

  console.log(results);
}

main();
