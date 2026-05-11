import { OAuthAccountProvider, type OAuthTokenSet } from "./oauth.js";

import type { OAuthProviderDependencies } from "./oauth.js";

function stringField(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    return undefined;
  }

  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getTikTokUserId(tokenSet: OAuthTokenSet): string {
  const userId = stringField(tokenSet.raw, "open_id") ?? stringField(tokenSet.raw, "union_id");
  if (!userId) {
    throw new Error("TikTok token response did not return open_id or union_id.");
  }

  return userId;
}

export class TikTokAuthProvider extends OAuthAccountProvider {
  public constructor(dependencies?: OAuthProviderDependencies) {
    super(
      "tiktok",
      {
        async completeLogin({ tokenSet }) {
          return { userId: getTikTokUserId(tokenSet) };
        },
      },
      dependencies,
    );
  }
}
