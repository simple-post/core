import { post } from "@simple-post/sdk";
import dotenv from "dotenv";

dotenv.config();

const relays = (process.env.NOSTR_RELAYS ?? "")
  .split(",")
  .map((relay) => relay.trim())
  .filter(Boolean);

const results = await post({
  content: { text: "A media note", media: [{ type: "image", url: "https://example.com/image.jpg" }] },
  platforms: ["nostr"],
  options: { nostr: { relays, subject: "SimplePost" } },
});

console.log(results);
