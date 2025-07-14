import dotenv from "dotenv";
import { post } from "unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  // Schedule posts for different times
  const facebookScheduleTime = new Date("2024-12-25T09:00:00Z"); // Christmas morning
  const youtubeScheduleTime = new Date("2024-12-25T12:00:00Z");  // Christmas noon

  console.log("Scheduling cross-platform posts...");
  console.log(`Facebook post scheduled for: ${facebookScheduleTime.toISOString()}`);
  console.log(`YouTube video scheduled for: ${youtubeScheduleTime.toISOString()}`);

  // Schedule a text post for Facebook
  const facebookResults = await post({
    content: {
      text: "🎄 Merry Christmas from our team! Hope you're having a wonderful holiday season. 🎅✨",
    },
    platforms: ["facebook"],
    options: {
      facebook: {
        scheduledPublishTime: facebookScheduleTime,
      },
    },
  });

  // Schedule a video for YouTube
  const youtubeResults = await post({
    content: {
      media: [
        {
          type: "video",
          path: "./assets/video_1.mp4",
          title: "Christmas Special 2024 🎄",
          description: "Join us for our special Christmas celebration! This video was scheduled to publish automatically on Christmas Day. Don't forget to like and subscribe for more holiday content!",
          thumbnailPath: "./assets/video_1_thumbnail.jpg",
        },
      ],
    },
    platforms: ["youtube"],
    options: {
      youtube: {
        publishAt: youtubeScheduleTime,
        tags: ["christmas", "holiday", "2024", "celebration", "special"],
        categoryId: "22", // People & Blogs
      },
    },
  });

  console.log("\n=== Scheduling Results ===");
  console.log("Facebook scheduled post:", facebookResults);
  console.log("YouTube scheduled video:", youtubeResults);

  console.log("\n✅ All posts have been scheduled successfully!");
  console.log("📅 Your content will be published automatically at the scheduled times.");
}

main().catch(console.error);