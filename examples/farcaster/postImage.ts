import { post } from "@simple-post/sdk";
import dotenv from "dotenv";
dotenv.config();
const results = await post({
  content: { text: "A cast with an image", media: [{ type: "image", url: "https://example.com/image.jpg" }] },
  platforms: ["farcaster"],
});
console.log(results);
