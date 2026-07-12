import { post } from "@simple-post/sdk";
import dotenv from "dotenv";
dotenv.config();
console.log(
  await post({
    content: { text: "# Building with SimplePost\n\nThis article was published through the Forem API." },
    platforms: ["forem"],
    options: { forem: { title: "Building with SimplePost", tags: ["typescript", "opensource"], published: true } },
  }),
);
