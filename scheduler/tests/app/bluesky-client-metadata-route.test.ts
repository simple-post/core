import { GET } from "@/app/oauth/client-metadata.json/route";

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalClientId = process.env.BLUESKY_CLIENT_ID;

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  if (originalClientId === undefined) {
    delete process.env.BLUESKY_CLIENT_ID;
  } else {
    process.env.BLUESKY_CLIENT_ID = originalClientId;
  }
});

it("publishes Bluesky client metadata for the configured app domain", async () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://dev.simplepost.social/";
  delete process.env.BLUESKY_CLIENT_ID;

  const response = GET();

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  await expect(response.json()).resolves.toEqual({
    client_id: "https://dev.simplepost.social/oauth/client-metadata.json",
    application_type: "web",
    client_name: "SimplePost",
    client_uri: "https://dev.simplepost.social",
    logo_uri: "https://dev.simplepost.social/simplepost-logo.png",
    tos_uri: "https://dev.simplepost.social/terms",
    policy_uri: "https://dev.simplepost.social/privacy",
    dpop_bound_access_tokens: true,
    grant_types: ["authorization_code", "refresh_token"],
    redirect_uris: ["https://dev.simplepost.social/api/connect/callback/bluesky"],
    response_types: ["code"],
    scope: "atproto transition:generic",
    token_endpoint_auth_method: "none",
  });
});

it("honors an explicitly configured Bluesky client ID", async () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://dev.simplepost.social";
  process.env.BLUESKY_CLIENT_ID = "https://oauth.simplepost.social/client.json";

  const response = GET();

  await expect(response.json()).resolves.toEqual(
    expect.objectContaining({ client_id: "https://oauth.simplepost.social/client.json" }),
  );
});
