import dotenv from "dotenv";
import { post } from "unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Check out this amazing image on Facebook!",
      media: [{ type: "image", path: "./facebook/data/1.jpg" }],
    },
    platforms: ["facebook"],
  });

  console.log(results);
}

main();