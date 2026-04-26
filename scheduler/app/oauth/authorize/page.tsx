"use client";

import { AuthorizePage } from "@/components/authorize-page";

export default function OAuthAuthorizePage() {
  return (
    <AuthorizePage
      config={{
        title: "Connect SimplePost",
        description:
          "ChatGPT or another MCP client is requesting permission to view connected accounts, validate drafts, and create or schedule posts through SimplePost.",
        invalidMessage:
          "This authorization link is invalid or has expired. Please try connecting again from your AI assistant.",
        successMessage: "Authorization successful. You can close this tab and return to your app.",
        loginCallbackPath: "/oauth/authorize",
        validateParams: (params) =>
          !!(
            params.get("client_id") &&
            params.get("redirect_uri") &&
            params.get("state") &&
            params.get("code_challenge")
          ),
        authorize: (params) =>
          fetch("/api/oauth/authorize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              client_id: params.get("client_id"),
              redirect_uri: params.get("redirect_uri"),
              state: params.get("state"),
              code_challenge: params.get("code_challenge"),
              code_challenge_method: params.get("code_challenge_method") || "S256",
              scope: params.get("scope"),
              resource: params.get("resource"),
            }),
          }),
        buildCancelUrl: (params) => {
          const redirect = new URL(params.get("redirect_uri")!);
          redirect.searchParams.set("error", "access_denied");
          redirect.searchParams.set("state", params.get("state")!);
          return redirect.toString();
        },
      }}
    />
  );
}
