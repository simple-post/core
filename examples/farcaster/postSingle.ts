import { post } from "@simple-post/sdk";
import dotenv from "dotenv";
dotenv.config();
const results = await post({ content: { text: "Hello Farcaster!" }, platforms: ["farcaster"] });
console.log(results);
