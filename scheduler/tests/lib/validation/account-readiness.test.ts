import { validatePostReadiness } from "@simple-post/sdk";

import { withAccountLock } from "@/lib/posting/account-lock";
import { validateAccountReadiness } from "@/lib/validation/account-readiness";
import { validatePostForResolvedAccounts } from "@/lib/validation/post-validation";
import type { ConnectedAccount } from "@/types";

jest.mock("@simple-post/sdk", () => ({ ...jest.requireActual("@simple-post/sdk"), validatePostReadiness: jest.fn() }));
jest.mock("@/lib/posting/account-lock", () => ({
  withAccountLock: jest.fn(async (_id, callback) => callback()),
  reloadAccountSecrets: async (account: unknown) => account,
}));
jest.mock("@/lib/oauth/credential-health", () => ({
  refreshConnectedAccountIfNeeded: async (account: unknown) => ({ account }),
}));
const account = {
  id: "account",
  platform: "bluesky",
  platformAccountId: "did:plc:test",
  accessToken: "secret",
} as ConnectedAccount;
beforeEach(() => jest.clearAllMocks());
it("runs eligibility under the account lock and promotes known denials to the summary", async () => {
  const validation = validatePostForResolvedAccounts({ accounts: [account], message: "Hello", media: [] });
  jest
    .mocked(validatePostReadiness)
    .mockResolvedValue([
      { platform: "bluesky", severity: "error", code: "account_ineligible", message: "Verify your email" },
    ]);
  await validateAccountReadiness(validation, { message: "Hello", media: [] });
  expect(withAccountLock).toHaveBeenCalledWith("account", expect.any(Function));
  expect(validation.summary).toMatchObject({
    isValid: false,
    errors: [expect.objectContaining({ code: "account_ineligible", meta: { accountId: "account" } })],
  });
});
it("preserves nonblocking unknown status and skips accounts with known content errors", async () => {
  const validation = validatePostForResolvedAccounts({ accounts: [account], message: "Hello", media: [] });
  jest.mocked(validatePostReadiness).mockRejectedValue(new Error("request contains secret"));
  await validateAccountReadiness(validation, { message: "Hello", media: [] });
  expect(validation.summary.isValid).toBe(true);
  expect(validation.summary.warnings).toContainEqual(expect.objectContaining({ code: "account_readiness_unverified" }));
  expect(JSON.stringify(validation.summary)).not.toContain("secret");
  jest.clearAllMocks();
  const invalid = validatePostForResolvedAccounts({ accounts: [account], message: "a".repeat(301), media: [] });
  await validateAccountReadiness(invalid, { message: "a".repeat(301), media: [] });
  expect(validatePostReadiness).not.toHaveBeenCalled();
});
