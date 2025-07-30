import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Check out this awesome video! 🎥",
      media: [
        {
          type: "video",
          path: "./assets/video_1.mp4",
          title: "Amazing Video",
          description: "This is an amazing video to share on Facebook",
        },
      ],
    },
    platforms: ["facebook"],
  });

  console.log(results);
}

main();
