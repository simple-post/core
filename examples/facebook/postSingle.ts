import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: { text: "Hey, this is a test Facebook post!" },
    platforms: ["facebook"],
  });

  console.log(results);
}

main();
