import dotenv from "dotenv";
import { post } from "unsubpost";

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
      options: {
        privacyStatus: "unlisted",
      },
    },
    platforms: ["youtube"],
  });

  console.log(results);
}

main();
