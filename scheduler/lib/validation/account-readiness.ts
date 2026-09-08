import { validatePostReadiness } from "@simple-post/sdk";
import { getXTextLength } from "@simple-post/sdk/validation";

import { refreshConnectedAccountIfNeeded } from "@/lib/oauth/credential-health";
import { reloadAccountSecrets, withAccountLock } from "@/lib/posting/account-lock";
import { buildPostOptions } from "@/lib/posting/credentials";
import type { AccountOptionsMap, AccountOverridesMap, MediaFile } from "@/types";

import type { ValidationResultByPlatform } from "./post-validation";
import type { Content, ThreadSegment } from "@simple-post/sdk";

/** Refresh under the same lock as publishing; never serialize credentials in validation results. */
export async function validateAccountReadiness(
  validation: ValidationResultByPlatform,
  params: {
    message: string;
    media: MediaFile[];
    accountOptions?: AccountOptionsMap;
    accountOverrides?: AccountOverridesMap;
    thread?: ThreadSegment[];
  },
): Promise<void> {
  for (const result of validation.results) {
    if (!result.isValid) continue;
    const account = validation.accounts.find((candidate) => candidate.id === result.accountId);
    if (!account) continue;
    const override = params.accountOverrides?.[account.id];
    const content: Content = {
      text: override?.message ?? params.message,
      media: (override?.media ?? params.media).map((file) =>
        file.type === "image"
          ? { type: "image", url: file.url, size: file.size }
          : {
              type: "video",
              url: file.url,
              size: file.size,
              durationSec: file.durationSec,
              thumbnailUrl: file.thumbnailUrl,
            },
      ),
    };
    // Check the most demanding segment for account-wide duration/long-text capabilities.
    for (const segment of override?.thread ?? params.thread ?? []) {
      if (["x", "bluesky", "threads", "telegram"].includes(result.platform)) {
        if (getXTextLength(segment.message ?? "") > getXTextLength(content.text ?? "")) content.text = segment.message;
        for (const file of segment.media ?? []) {
          content.media?.push(
            file.type === "video"
              ? { type: "video", url: file.url, durationSec: file.durationSec }
              : { type: "image", url: file.url },
          );
        }
      }
    }
    try {
      const issues = await withAccountLock(account.id, async () => {
        const fresh = await reloadAccountSecrets(account);
        const credentials = await refreshConnectedAccountIfNeeded(fresh, { reason: "post" });
        if (credentials.error)
          return [
            {
              platform: result.platform,
              severity: "error" as const,
              code: "account_unauthorized",
              field: "account",
              message: "The account connection needs attention. Reconnect it before publishing.",
            },
          ];
        return validatePostReadiness(
          result.platform,
          content,
          buildPostOptions(credentials.account, params.accountOptions),
        );
      });
      for (const issue of issues)
        (issue.severity === "error" ? result.errors : result.warnings).push({
          ...issue,
          meta: { accountId: account.id },
        });
    } catch {
      result.warnings.push({
        platform: result.platform,
        severity: "warning",
        code: "account_readiness_unverified",
        field: "account",
        message: "Current account eligibility could not be verified. Check the connection and retry validation.",
        meta: { accountId: account.id },
      });
    }
    result.isValid = result.errors.length === 0;
  }
  validation.summary.errors = [
    ...validation.summary.errors.filter((issue) => issue.platform === "common"),
    ...validation.results.flatMap((result) => result.errors),
  ];
  validation.summary.warnings = validation.results.flatMap((result) => result.warnings);
  validation.summary.isValid = validation.summary.errors.length === 0;
}
