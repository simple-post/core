"use client";

import { AuthorizePage } from "@/components/authorize-page";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

export function OAuthConsent({ allowReadOnly }: { allowReadOnly: boolean }) {
  const { copy } = useUiCopy();
  return (
    <AuthorizePage
      config={{
        title: copy("Connect SimplePost"),
        allowReadOnly,
        description: allowReadOnly
          ? copy("Choose how much access Muse gets to your SimplePost account.")
          : copy(
              "ChatGPT or another MCP client is requesting permission to view connected accounts, inspect post history, validate drafts, and create or manage drafts and scheduled posts through SimplePost.",
            ),
        invalidMessage: copy(
          "This authorization link is invalid or has expired. Please try connecting again from your AI assistant.",
        ),
        successMessage: copy("Authorization successful. You can close this tab and return to your app."),
        loginCallbackPath: "/oauth/authorize",
        validateParams: (params) =>
          !!(
            params.get("client_id") &&
            params.get("redirect_uri") &&
            params.get("state") &&
            params.get("code_challenge")
          ),
        authorize: (params, accessMode) =>
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
              nonce: params.get("nonce") || undefined,
              ...(allowReadOnly ? { access_mode: accessMode } : {}),
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
