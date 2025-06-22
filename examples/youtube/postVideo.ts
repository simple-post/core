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
          path: "./youtube/data/horizontal.mp4",
          title: "Test video",
          description: "This is a test video",
          thumbnailPath: "./youtube/data/horizontal.jpg",
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
