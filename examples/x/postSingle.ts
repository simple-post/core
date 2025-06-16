import dotenv from "dotenv";
import { post } from "unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  await post({
    content: { text: "Hey, this is a test tweet" },
    platforms: ["x"],
  });
}

main();
