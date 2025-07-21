import dotenv from "dotenv";
import { post } from "@unsubpost/unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const threadContent = ["Hey, this is a test thread. 1/3", "This is post 2/3", "This is post 3/3"];

  let previousTweetId: string | undefined;

  for (let i = 0; i < threadContent.length; i++) {
    const content = threadContent[i];

    const results = await post({
      content: { text: content },
      platforms: ["x"],
      options: {
        x: previousTweetId ? { replyToId: previousTweetId } : undefined,
      },
    });

    const tweetId = results.get("x")?.id;
    if (!tweetId) {
      console.error(`Failed to post tweet ${i + 1}`);
      return;
    }

    previousTweetId = tweetId;
    console.log(`Tweet ${i + 1} posted successfully:`, results);
  }

  console.log("Thread posted successfully!");
}

main();
