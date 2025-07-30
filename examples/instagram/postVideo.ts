import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Amazing video content! 🎥 Hope you enjoy this moment! #video #content #instagram",
      media: [
        {
          type: "video",
          path: "./assets/video_vertical.mp4",
        },
      ],
    },
    platforms: ["instagram"],
  });

  console.log(results);
}

main();
