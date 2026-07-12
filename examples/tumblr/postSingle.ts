import "dotenv/config";

import { post } from "@simple-post/sdk";

const result = await post({
  content: { text: "Hello from SimplePost on Tumblr!" },
  platforms: ["tumblr"],
  options: {
    tumblr: {
      blogIdentifier: process.env.TUMBLR_BLOG_IDENTIFIER!,
      tags: ["simplepost", "api"],
    },
  },
});

console.log(result);
