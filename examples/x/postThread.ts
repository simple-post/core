import dotenv from "dotenv";
import { post } from "unsubpost";
import { Content } from "../../lib/src/types/post";

// Load environment variables from .env file
dotenv.config();

async function main() {
  const results = await post({
    content: [{ text: "Hey, this is a test thread. 1/3" }, { text: "This is post 2/3" }, { text: "This is post 3/3" }],
    platforms: ["x"],
  });

  console.log(results);
}

main();
