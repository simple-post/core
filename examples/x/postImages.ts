import dotenv from "dotenv";
import { post } from "unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Hey, posting images",
      media: [
        { type: "image", path: "./x/data/1.jpg" },
        { type: "image", path: "./x/data/2.jpg" },
        { type: "image", path: "./x/data/3.jpg" },
        { type: "image", path: "./x/data/4.jpg" },
      ],
    },
    platforms: ["x"],
  });

  console.log(results);
}

main();
