import "dotenv/config";

import { post } from "@simple-post/sdk";

const results = await post({
  content: { text: "Hello from SimplePost and the fediverse!" },
  platforms: ["mastodon"],
  options: {
    mastodon: { visibility: "public" },
  },
});

console.log(results.get("mastodon"));
