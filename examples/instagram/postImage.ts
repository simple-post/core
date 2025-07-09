import dotenv from "dotenv";
import { post } from "unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "Beautiful sunset vibes! 🌅 #sunset #photography",
      media: [{ type: "image", path: "./assets/image_1.jpg" }],
    },
    platforms: ["instagram"],
  });

  console.log(results, results.get("instagram")?.[0]?.details);
}

main();
