import "dotenv/config";

import { post } from "@simple-post/sdk";

const subreddit = process.env.REDDIT_SUBREDDIT;
if (!subreddit) throw new Error("Set REDDIT_SUBREDDIT before running this example.");

const results = await post({
  content: { text: "" },
  platforms: ["reddit"],
  options: {
    reddit: {
      subreddit,
      title: "SimplePost — one API for social publishing",
      url: "https://simplepost.social",
    },
  },
});

console.log(results.get("reddit"));
