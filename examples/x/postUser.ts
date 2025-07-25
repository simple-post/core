import dotenv from "dotenv";
import { post } from "@unsubpost/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  // OAuth client ID and secret and user credentials you have obtained after the user logged in with your app
  const userCredentials = {
    clientId: "X_APP_CLIENT_ID",
    clientSecret: "X_APP_CLIENT_SECRET",
    accessToken: "USER_ACCESS_TOKEN",
    refreshToken: "USER_REFRESH_TOKEN",
    expiresAt: 1234567890, // Unix timestamp then the token expires
  };

  const results = await post({
    content: {
      text: "Hello from X using OAuth credentials!",
    },
    platforms: ["x"],
    options: {
      x: {
        credentials: userCredentials,
      },
    },
  });

  console.log(results, results.get("x")?.extraData);
}

main();
