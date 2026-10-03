import { validatePostReadiness } from "@simple-post/sdk";

import { refreshConnectedAccountIfNeeded } from "@/lib/oauth/credential-health";
import { reloadAccountSecrets, withAccountLock } from "@/lib/posting/account-lock";
import { recordMetaCredentialRejection } from "@/lib/posting/credential-rejection";
import { validateAccountReadiness } from "@/lib/validation/account-readiness";
import { validatePostForResolvedAccounts } from "@/lib/validation/post-validation";
import type { ConnectedAccount } from "@/types";

jest.mock("@simple-post/sdk", () => ({ ...jest.requireActual("@simple-post/sdk"), validatePostReadiness: jest.fn() }));
jest.mock("@/lib/posting/account-lock", () => ({
  withAccountLock: jest.fn(async (_id, callback) => callback()),
  reloadAccountSecrets: jest.fn(async (account: unknown) => account),
}));
jest.mock("@/lib/oauth/credential-health", () => ({
  refreshConnectedAccountIfNeeded: jest.fn(async (account: unknown) => ({ account })),
}));
jest.mock("@/lib/posting/credential-rejection", () => ({ recordMetaCredentialRejection: jest.fn() }));
const account = {
  id: "account",
  platform: "bluesky",
  platformAccountId: "did:plc:test",
  accessToken: "secret",
} as ConnectedAccount;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(recordMetaCredentialRejection).mockReset().mockResolvedValue("recorded");
  jest
    .mocked(reloadAccountSecrets)
    .mockReset()
    .mockImplementation(async (account) => account);
  jest
    .mocked(refreshConnectedAccountIfNeeded)
    .mockReset()
    .mockImplementation(async (account) => ({ account }) as never);
});
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

const instagram = {
  ...account,
  platform: "instagram",
  updatedAt: new Date("2026-09-27T05:25:33Z"),
} as ConnectedAccount;
const revokedIssue = {
  platform: "instagram" as const,
  severity: "error" as const,
  code: "account_unauthorized",
  message: "Reconnect Instagram",
  credentialRejection: { reason: "session_revoked" as const, code: 190, status: 401, subcode: 0 },
};
const instagramValidation = () =>
  validatePostForResolvedAccounts({
    accounts: [instagram],
    message: "Hello",
    media: [
      { id: "photo", filename: "photo.jpg", size: 1024, type: "image", url: "https://example.invalid/photo.jpg" },
    ],
  });

it("records preflight revocation before returning the blocking validation issue", async () => {
  jest.mocked(validatePostReadiness).mockResolvedValue([revokedIssue]);
  const validation = instagramValidation();
  await validateAccountReadiness(validation, { message: "Hello", media: [] });
  expect(recordMetaCredentialRejection).toHaveBeenCalledWith(instagram, revokedIssue.credentialRejection);
  expect(validation.summary.isValid).toBe(false);
  expect(validation.summary.errors).toContainEqual(expect.objectContaining({ code: "account_unauthorized" }));
});

it("preserves the rejection when recording state fails", async () => {
  jest.mocked(validatePostReadiness).mockResolvedValue([revokedIssue]);
  jest.mocked(recordMetaCredentialRejection).mockRejectedValue(new Error("database unavailable"));
  const validation = instagramValidation();
  await validateAccountReadiness(validation, { message: "Hello", media: [] });
  expect(validation.summary.isValid).toBe(false);
  expect(validation.summary.warnings).toEqual([]);
});

it("rechecks once against a newer connection when an old request loses the generation guard", async () => {
  const newer = { ...instagram, accessToken: "new-session", updatedAt: new Date("2026-10-03T12:00:00Z") };
  jest.mocked(reloadAccountSecrets).mockResolvedValueOnce(instagram).mockResolvedValueOnce(newer);
  jest.mocked(validatePostReadiness).mockResolvedValueOnce([revokedIssue]).mockResolvedValueOnce([]);
  jest.mocked(recordMetaCredentialRejection).mockResolvedValueOnce("stale");
  const validation = instagramValidation();
  await validateAccountReadiness(validation, { message: "Hello", media: [] });
  expect(validatePostReadiness).toHaveBeenCalledTimes(2);
  expect(validatePostReadiness).toHaveBeenLastCalledWith(
    "instagram",
    expect.anything(),
    expect.objectContaining({
      instagram: expect.objectContaining({ credentials: expect.objectContaining({ accessToken: "new-session" }) }),
    }),
  );
  expect(validation.summary.isValid).toBe(true);
});

it("bounds rechecks and keeps rejecting when two credential generations are rejected", async () => {
  jest.mocked(validatePostReadiness).mockResolvedValue([revokedIssue]);
  jest.mocked(recordMetaCredentialRejection).mockResolvedValue("stale");
  const validation = instagramValidation();
  await validateAccountReadiness(validation, { message: "Hello", media: [] });
  expect(validatePostReadiness).toHaveBeenCalledTimes(2);
  expect(validation.summary.isValid).toBe(false);
});

it("stops before provider calls for blocked credentials even without a legacy error field", async () => {
  jest.mocked(refreshConnectedAccountIfNeeded).mockResolvedValue({
    account: { ...instagram, credentialRefreshBlockedAt: new Date() },
    status: { state: "reauth_required", severity: "error", message: "Session invalidated; reconnect" },
  } as never);
  const validation = instagramValidation();
  await validateAccountReadiness(validation, { message: "Hello", media: [] });
  expect(validatePostReadiness).not.toHaveBeenCalled();
  expect(validation.summary.isValid).toBe(false);
});

it.each(["facebook", "threads"] as const)("records %s preflight revocation", async (platform) => {
  const meta = { ...instagram, platform } as ConnectedAccount;
  const issue = { ...revokedIssue, platform };
  jest.mocked(validatePostReadiness).mockResolvedValue([issue]);
  const validation = validatePostForResolvedAccounts({ accounts: [meta], message: "Hello", media: [] });
  await validateAccountReadiness(validation, { message: "Hello", media: [] });
  expect(recordMetaCredentialRejection).toHaveBeenCalledWith(meta, issue.credentialRejection);
  expect(validation.summary.isValid).toBe(false);
});

it("does not persist generic 401s or transient provider warnings", async () => {
  jest.mocked(validatePostReadiness).mockResolvedValue([{ ...revokedIssue, credentialRejection: undefined }]);
  const validation = instagramValidation();
  await validateAccountReadiness(validation, { message: "Hello", media: [] });
  expect(recordMetaCredentialRejection).not.toHaveBeenCalled();
});
