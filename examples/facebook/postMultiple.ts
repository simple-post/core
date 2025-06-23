import dotenv from "dotenv";
import { post } from "unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: [
      { text: "First Facebook post in sequence! 🚀" },
      { 
        text: "Second post with an image! 📷",
        media: [{ type: "image", path: "./data/image1.jpg" }]
      },
      { text: "Third and final post! ✨" }
    ],
    platforms: ["facebook"],
  });

  console.log(results);
}

main();