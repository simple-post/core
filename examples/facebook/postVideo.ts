import dotenv from "dotenv";
import { post } from "unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Watch this awesome video on Facebook!",
      media: [
        {
          type: "video",
          path: "./facebook/data/1.mp4",
          title: "Facebook Video Demo",
          description: "A demonstration video for Facebook posting",
        },
      ],
    },
    platforms: ["facebook"],
  });

  console.log(results);
}

main();