import { post } from "@simple-post/sdk";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const results = await post({
    content: { text: "Hello from SimplePost!" },
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
