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
          title: "Test video full",
          description: "This is a test video with all parameters",
          thumbnailPath: "./assets/video_1_thumbnail.jpg",
        },
      ],
    },
    platforms: ["youtube"],
    options: {
      common: {
        privacyStatus: "unlisted",
      },
      youtube: {
        tags: ["test", "video"],
        categoryId: "10",
        selfDeclaredMadeForKids: true,
      },
    },
  });

  console.log(results);
}

main();
