import "dotenv/config";

import { post } from "@simple-post/sdk";

const subreddit = process.env.REDDIT_SUBREDDIT;
if (!subreddit) throw new Error("Set REDDIT_SUBREDDIT before running this example.");

const results = await post({
  content: { text: "Hello from SimplePost" },
  platforms: ["reddit"],
  options: {
    reddit: {
      subreddit,
      title: "Hello from SimplePost",
    },
  },
});

console.log(results.get("reddit"));
