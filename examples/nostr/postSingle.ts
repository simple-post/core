import { post } from "@simple-post/sdk";
import dotenv from "dotenv";

dotenv.config();

const relays = (process.env.NOSTR_RELAYS ?? "")
  .split(",")
  .map((relay) => relay.trim())
  .filter(Boolean);

const results = await post({
  content: { text: "Hello from SimplePost on Nostr!" },
  platforms: ["nostr"],
  options: { nostr: { relays } },
});

console.log(results);
