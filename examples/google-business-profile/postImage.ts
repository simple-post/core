import { post } from "@simple-post/sdk";
import dotenv from "dotenv";
dotenv.config();
const results = await post({
  content: { text: "See what is new", media: [{ type: "image", url: "https://example.com/image.jpg" }] },
  platforms: ["google_business_profile"],
  options: {
    google_business_profile: {
      locationName: process.env.GOOGLE_BUSINESS_PROFILE_LOCATION_NAME!,
      callToAction: { actionType: "LEARN_MORE", url: "https://example.com" },
    },
  },
});
console.log(results);
