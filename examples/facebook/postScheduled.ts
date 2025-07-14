import dotenv from "dotenv";
import { post } from "unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  // Schedule a post for Christmas Day 2024 at 12:00 PM UTC
  const scheduledTime = new Date("2024-12-25T12:00:00Z");

  const results = await post({
    content: {
      text: "🎄 Merry Christmas! This post was scheduled in advance. 🎅",
    },
    platforms: ["facebook"],
    options: {
      facebook: {
        scheduledPublishTime: scheduledTime,
      },
    },
  });

  console.log("Scheduled post results:", results);
}

main();