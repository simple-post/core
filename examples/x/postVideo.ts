import dotenv from "dotenv";
import { post } from "@unsubpost/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Hey, posting video",
      media: [{ type: "video", path: "./assets/video_1.mp4" }],
    },
    platforms: ["x"],
  });

  console.log(results);
}

main();
