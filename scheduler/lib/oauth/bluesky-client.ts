import { env } from "@/lib/env";

export const BLUESKY_CLIENT_METADATA_PATH = "/oauth/client-metadata.json";

function getAppBaseUrl(): string {
  return env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
}

export function getBlueskyClientId(): string {
  return process.env.BLUESKY_CLIENT_ID || `${getAppBaseUrl()}${BLUESKY_CLIENT_METADATA_PATH}`;
}

export function getBlueskyClientMetadata() {
  const baseUrl = getAppBaseUrl();

  return {
    client_id: getBlueskyClientId(),
    application_type: "web",
    client_name: "SimplePost",
    client_uri: baseUrl,
    logo_uri: `${baseUrl}/simplepost-logo.png`,
    tos_uri: `${baseUrl}/terms`,
    policy_uri: `${baseUrl}/privacy`,
    dpop_bound_access_tokens: true,
    grant_types: ["authorization_code", "refresh_token"],
    redirect_uris: [`${baseUrl}/api/connect/callback/bluesky`],
    response_types: ["code"],
    scope: "atproto transition:generic",
    token_endpoint_auth_method: "none",
  };
}
