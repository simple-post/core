import { GET as getJwks } from "@/app/api/oauth/jwks/route";

import { GET as getOAuthMetadata } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as getOidcMetadata } from "@/app/.well-known/openid-configuration/route";

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
});

it("publishes OIDC discovery metadata required for workspace domain restrictions", async () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://app.simplepost.social/";

  const response = getOidcMetadata();

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual(
    expect.objectContaining({
      issuer: "https://app.simplepost.social",
      userinfo_endpoint: "https://app.simplepost.social/api/oauth/userinfo",
      jwks_uri: "https://app.simplepost.social/api/oauth/jwks",
      scopes_supported: expect.arrayContaining(["openid", "email"]),
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["ES256"],
    }),
  );
});

it("also advertises OIDC capabilities in OAuth authorization-server metadata", async () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://app.simplepost.social";

  const response = getOAuthMetadata();

  await expect(response.json()).resolves.toEqual(
    expect.objectContaining({
      userinfo_endpoint: "https://app.simplepost.social/api/oauth/userinfo",
      scopes_supported: expect.arrayContaining(["openid", "email"]),
    }),
  );
});

it("publishes an ES256 public key without private key material", async () => {
  const response = getJwks();
  const body = await response.json();

  expect(body.keys).toHaveLength(1);
  expect(body.keys[0]).toEqual(
    expect.objectContaining({
      alg: "ES256",
      crv: "P-256",
      kid: expect.any(String),
      kty: "EC",
      use: "sig",
      x: expect.any(String),
      y: expect.any(String),
    }),
  );
  expect(body.keys[0]).not.toHaveProperty("d");
});
