import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  // Schedule a post for New Year's Day 2030 at 12:00 PM UTC
  const results = await post({
    content: {
      text: "🎊 Happy New Year 2030! This post was scheduled in advance. 🎉",
    },
    platforms: ["facebook"],
    options: {
      facebook: {
        publishAt: "2030-01-01T12:00:00Z",
      },
    },
  });

  console.log("Scheduled post results:", results);
}

main();
