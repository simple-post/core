import "dotenv/config";

import { post } from "@simple-post/sdk";

const results = await post({
  content: {
    text: "An image posted through SimplePost",
    media: [{ type: "image", path: "../assets/image_1.jpg", caption: "A sample landscape" }],
  },
  platforms: ["mastodon"],
  options: {
    mastodon: { visibility: "unlisted", sensitive: false },
  },
});

console.log(results.get("mastodon"));
