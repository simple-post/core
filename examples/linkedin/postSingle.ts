import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Sharing an update on LinkedIn via SimplePost.",
      media: [{ type: "image", path: "./assets/image_3.jpg" }],
    },
    platforms: ["linkedin"],
    options: {
      linkedin: {
        visibility: "PUBLIC",
      },
    },
  });

  console.log(results);
}

main();
