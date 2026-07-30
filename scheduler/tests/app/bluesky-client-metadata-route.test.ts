import crypto from "node:crypto";

import { GET } from "@/app/oauth/client-metadata.json/route";
import { BLUESKY_CLIENT_ASSERTION_TYPE, addBlueskyClientAuthentication } from "@/lib/oauth/bluesky-client";

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalClientId = process.env.BLUESKY_CLIENT_ID;
const originalPrivateJwk = process.env.BLUESKY_CLIENT_PRIVATE_JWK;
const originalKeyId = process.env.BLUESKY_CLIENT_KEY_ID;

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  if (originalClientId === undefined) {
    delete process.env.BLUESKY_CLIENT_ID;
  } else {
    process.env.BLUESKY_CLIENT_ID = originalClientId;
  }
  if (originalPrivateJwk === undefined) {
    delete process.env.BLUESKY_CLIENT_PRIVATE_JWK;
  } else {
    process.env.BLUESKY_CLIENT_PRIVATE_JWK = originalPrivateJwk;
  }
  if (originalKeyId === undefined) {
    delete process.env.BLUESKY_CLIENT_KEY_ID;
  } else {
    process.env.BLUESKY_CLIENT_KEY_ID = originalKeyId;
  }
});

it("publishes Bluesky client metadata for the configured app domain", async () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://dev.simplepost.social/";
  delete process.env.BLUESKY_CLIENT_ID;
  delete process.env.BLUESKY_CLIENT_PRIVATE_JWK;
  delete process.env.BLUESKY_CLIENT_KEY_ID;

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
  delete process.env.BLUESKY_CLIENT_PRIVATE_JWK;

  const response = GET();

  await expect(response.json()).resolves.toEqual(
    expect.objectContaining({ client_id: "https://oauth.simplepost.social/client.json" }),
  );
});

it("publishes a confidential client key and signs client assertions when configured", async () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://dev.simplepost.social";
  delete process.env.BLUESKY_CLIENT_ID;
  process.env.BLUESKY_CLIENT_KEY_ID = "test-key";
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  process.env.BLUESKY_CLIENT_PRIVATE_JWK = JSON.stringify(privateKey.export({ format: "jwk" }));

  const response = GET();
  const metadata = await response.json();
  expect(metadata).toEqual(
    expect.objectContaining({
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_signing_alg: "ES256",
      jwks: {
        keys: [
          expect.objectContaining({
            alg: "ES256",
            crv: "P-256",
            kid: "test-key",
            kty: "EC",
            use: "sig",
          }),
        ],
      },
    }),
  );
  expect(metadata.jwks.keys[0]).not.toHaveProperty("d");

  const body = new URLSearchParams();
  addBlueskyClientAuthentication(body, "https://bsky.social");
  expect(body.get("client_assertion_type")).toBe(BLUESKY_CLIENT_ASSERTION_TYPE);

  const assertion = body.get("client_assertion");
  expect(assertion).toBeTruthy();
  const [encodedHeader, encodedPayload, encodedSignature] = assertion!.split(".");
  expect(JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"))).toEqual(
    expect.objectContaining({ alg: "ES256", kid: "test-key", typ: "JWT" }),
  );
  expect(JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"))).toEqual(
    expect.objectContaining({
      aud: "https://bsky.social",
      iss: "https://dev.simplepost.social/oauth/client-metadata.json",
      sub: "https://dev.simplepost.social/oauth/client-metadata.json",
    }),
  );
  expect(encodedSignature).toBeTruthy();

  const publicKey = crypto.createPublicKey({
    format: "jwk",
    key: metadata.jwks.keys[0],
  });
  expect(
    crypto.verify(
      "sha256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      { dsaEncoding: "ieee-p1363", key: publicKey },
      Buffer.from(encodedSignature, "base64url"),
    ),
  ).toBe(true);
});
