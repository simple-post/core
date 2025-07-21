import dotenv from "dotenv";
import { post } from "@unsubpost/unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  // Schedule a video for New Year's Day 2030 at 12:00 PM UTC
  const scheduledTime = new Date("2030-01-01T12:00:00Z");

  const results = await post({
    content: {
      media: [
        {
          type: "video",
          path: "./assets/video_1.mp4",
          title: "🎊 Happy New Year 2030! 🎊",
          description: "Welcome to 2030! This video was scheduled in advance to celebrate the new year.",
          thumbnailPath: "./assets/video_1_thumbnail.jpg",
        },
      ],
    },
    platforms: ["youtube"],
    options: {
      youtube: {
        publishAt: scheduledTime,
        tags: ["new year", "2030", "celebration", "scheduled"],
        categoryId: "22", // People & Blogs
      },
    },
  });

  console.log("Scheduled video results:", results);
}

main();