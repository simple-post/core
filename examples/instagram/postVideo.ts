import dotenv from "dotenv";
import { post } from "unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Amazing video content! 🎥 Hope you enjoy this moment! #video #content #instagram",
      media: [
        {
          type: "video",
          path: "./assets/video_1.mp4",
        },
      ],
    },
    platforms: ["instagram"],
  });

  console.log(results);
}

main();
