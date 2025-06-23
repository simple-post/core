import dotenv from "dotenv";
import { post } from "unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Check out these amazing images! 📸",
      media: [
        { type: "image", path: "./data/image1.jpg" },
        { type: "image", path: "./data/image2.jpg" },
        { type: "image", path: "./data/image3.jpg" },
      ],
    },
    platforms: ["facebook"],
  });

  console.log(results);
}

main();