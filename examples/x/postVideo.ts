import dotenv from "dotenv";
import { post } from "unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Hey, posting video",
      media: [{ type: "video", path: "./x/data/1.mp4" }],
    },
    platforms: ["x"],
  });

  console.log(results);
}

main();
