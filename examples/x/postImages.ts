import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Hey, posting images",
      media: [
        { type: "image", path: "./assets/image_1.jpg" },
        { type: "image", path: "./assets/image_2.jpg" },
        { type: "image", path: "./assets/image_3.jpg" },
        { type: "image", path: "./assets/image_4.jpg" },
      ],
    },
    platforms: ["x"],
  });

  console.log(results);
}

main();
