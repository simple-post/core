import crypto from "node:crypto";

import { createOidcIdToken, getOidcJwks } from "@/lib/mcp/oidc";

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
});

it("creates a verifiable ID token containing the verified email claims", () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://app.simplepost.social/";

  const token = createOidcIdToken({
    clientId: "chatgpt-client",
    identity: {
      email: "demo@simplepost.social",
      emailVerified: true,
      name: "OpenAI Reviewer",
      userId: "user_123",
    },
    nonce: "nonce_123",
  });
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));

  expect(header).toEqual(expect.objectContaining({ alg: "ES256", kid: expect.any(String), typ: "JWT" }));
  expect(payload).toEqual(
    expect.objectContaining({
      aud: "chatgpt-client",
      email: "demo@simplepost.social",
      email_verified: true,
      iss: "https://app.simplepost.social",
      nonce: "nonce_123",
      sub: "user_123",
    }),
  );

  const publicKey = crypto.createPublicKey({ format: "jwk", key: getOidcJwks().keys[0] });
  expect(
    crypto.verify(
      "sha256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      { dsaEncoding: "ieee-p1363", key: publicKey },
      Buffer.from(encodedSignature, "base64url"),
    ),
  ).toBe(true);
});
