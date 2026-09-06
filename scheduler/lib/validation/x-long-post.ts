import { createLogger } from "@/lib/logger";
import { refreshConnectedAccountIfNeeded } from "@/lib/oauth/credential-health";
import { reloadAccountSecrets, withAccountLock } from "@/lib/posting/account-lock";

import type { ValidationResultByPlatform } from "./post-validation";

const log = createLogger("x-post-validation");

/** Resolve only long-post warnings, once per account, before saving or publishing. */
export async function validateXLongPostAccess(validation: ValidationResultByPlatform): Promise<void> {
  for (const result of validation.results) {
    if (result.platform !== "x" || !result.isValid) continue;
    const longPosts = result.warnings.filter((issue) => issue.code === "long_post");
    if (longPosts.length === 0) continue;
    const account = validation.accounts.find((candidate) => candidate.id === result.accountId);
    if (!account) continue;

    try {
      const subscriptionType = await withAccountLock(account.id, async () => {
        const fresh = await reloadAccountSecrets(account);
        const credentials = await refreshConnectedAccountIfNeeded(fresh, { reason: "post" });
        if (credentials.error) return;
        const response = await fetch("https://api.x.com/2/users/me?user.fields=subscription_type", {
          headers: { Authorization: `Bearer ${credentials.account.accessToken}` },
          signal: AbortSignal.timeout(10_000),
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = (await response.json()) as { data?: { subscription_type?: string } };
        return body.data?.subscription_type;
      });
      // Missing/unknown subscription data is not proof of ineligibility. Keep
      // the actionable warning and let the publisher recheck before sending.
      if (subscriptionType?.toLowerCase() !== "none") continue;
      for (const warning of longPosts) {
        result.errors.push({
          ...warning,
          severity: "error",
          code: "long_post_requires_premium",
          message: `X counts this post as ${warning.actual} characters. This account does not have X Premium. Shorten it to 280 weighted characters or split it into a thread.`,
        });
      }
      result.warnings = result.warnings.filter((issue) => issue.code !== "long_post");
      result.isValid = false;
    } catch {
      // Never log a request object containing the account's bearer token.
      log.warn({ accountId: account.id }, "Could not check X long-post eligibility during validation");
    }
  }
  // Preserve cross-account errors while replacing any promoted warnings.
  const accountErrors = validation.results.flatMap((result) => result.errors);
  validation.summary.errors = [
    ...validation.summary.errors.filter((issue) => issue.platform === "common"),
    ...accountErrors,
  ];
  validation.summary.warnings = validation.results.flatMap((result) => result.warnings);
  validation.summary.isValid = validation.summary.errors.length === 0;
}
