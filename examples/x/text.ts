import dotenv from "dotenv";
import { post } from "unsubpost";

// Load environment variables from .env file
dotenv.config();

async function main() {
  await post({
    content: { text: "Hey" },
    platforms: ["x"],
  });
}

main();
