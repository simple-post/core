import dotenv from "dotenv";
import { post } from "@unsubpost/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  // Schedule a post for New Year's Day 2030 at 12:00 PM UTC
  const scheduledTime = new Date("2030-01-01T12:00:00Z");

  const results = await post({
    content: {
      text: "🎊 Happy New Year 2030! This post was scheduled in advance. 🎉",
    },
    platforms: ["facebook"],
    options: {
      facebook: {
        publishAt: scheduledTime,
      },
    },
  });

  console.log("Scheduled post results:", results);
}

main();
