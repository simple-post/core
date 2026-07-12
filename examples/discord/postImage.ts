import { post } from "@simple-post/sdk";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const results = await post({
    content: {
      text: "An image posted through a Discord webhook",
      media: [{ type: "image", path: "./assets/image_1.jpg" }],
    },
    platforms: ["discord"],
    options: {
      discord: {
        credentials: { webhookUrl: process.env.DISCORD_WEBHOOK_URL! },
      },
    },
  });

  console.log(results);
}

main();
