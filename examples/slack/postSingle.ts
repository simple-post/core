import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

dotenv.config();

const results = await post({
  content: { text: "Hello from SimplePost on Slack!" },
  platforms: ["slack"],
  options: { slack: { channelId: process.env.SLACK_CHANNEL_ID! } },
});

console.log(results);
