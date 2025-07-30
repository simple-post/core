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
          path: "./assets/video_1.mp4",
          title: "Test video",
          description: "This is a test video",
          thumbnailPath: "./assets/video_1_thumbnail.jpg",
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
