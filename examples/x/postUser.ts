import dotenv from "dotenv";
import { post } from "@simple-post/sdk";

// Load environment variables from .env file
dotenv.config();

async function main() {
  // X OAuth 2.0 user credentials. The SDK supports three modes:
  //
  //   1. accessToken only — no refresh capability, the access token is used as-is
  //      until it expires (~2h). This is the safest option if you're calling the
  //      API only occasionally and persist the token externally.
  //   2. clientId + refreshToken (+ optional clientSecret) — the SDK exchanges the
  //      refresh token for a fresh access token on first call. NOTE: X rotates
  //      refresh tokens on every refresh; you MUST persist the new refreshToken
  //      returned in result.extraData.refreshedCredentials, or the next refresh
  //      will fail with invalid_grant.
  //   3. Both — pass an accessToken/expiresAt and a refreshToken; the SDK uses
  //      the access token while it's valid and only refreshes when needed.
  //
  // This example uses mode 1 (access token only) so it can be re-run multiple
  // times within the access token's lifetime without rotating the refresh token.
  const userCredentials = {
    clientId: "X_APP_CLIENT_ID",
    accessToken: "USER_ACCESS_TOKEN",
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
