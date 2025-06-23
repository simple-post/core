import dotenv from "dotenv";
import { post } from "unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: [
      { text: "First Facebook post in the series!" },
      { text: "Second Facebook post with more information." },
      {
        text: "Third post with an image to wrap things up!",
        media: [{ type: "image", path: "./facebook/data/2.jpg" }],
      },
    ],
    platforms: ["facebook"],
  });

  console.log(results);
}

main();