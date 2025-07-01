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
          path: "./youtube/data/vertical.mp4",
          title: "Test short",
          description: "This is a test short",
          thumbnailPath: "./youtube/data/vertical.jpg",
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
