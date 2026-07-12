import { post } from "@simple-post/sdk";
import dotenv from "dotenv";
dotenv.config();
const results = await post({
  content: { text: "We have something new to share!" },
  platforms: ["google_business_profile"],
});
console.log(results);
