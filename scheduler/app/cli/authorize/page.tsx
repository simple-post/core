"use client";
import { AuthorizePage } from "@/components/authorize-page";
import { UiCopy } from "@/components/ui-copy";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

export default function CliAuthorizePage() {
  const { copy } = useUiCopy();
  return (
    <AuthorizePage
      config={{
        title: copy("Authorize CLI"),
        description: copy("The SimplePost CLI is requesting access to your account."),
        invalidMessage: (
          <UiCopy
            source="This authorization link is invalid or has expired. Please run <part1></part1> again."
            components={{
              part1: (
                <code className="bg-secondary border border-border text-primary font-mono px-1.5 py-0.5 rounded text-xs">
                  simplepost connect
                </code>
              ),
            }}
          />
        ),
        successMessage: copy("Authorization successful. You can close this tab and return to your terminal."),
        loginCallbackPath: "/cli/authorize",
        validateParams: (params) => {
          const state = params.get("state");
          const redirectUri = params.get("redirect_uri");
          if (!state || !redirectUri) return false;
          try {
            return isLoopbackHost(new URL(redirectUri).hostname);
          } catch {
            return false;
          }
        },
        authorize: (params) =>
          fetch("/api/cli/authorize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              state: params.get("state"),
              redirectUri: params.get("redirect_uri"),
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
