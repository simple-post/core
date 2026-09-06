import { refreshConnectedAccountIfNeeded } from "@/lib/oauth/credential-health";
import { reloadAccountSecrets } from "@/lib/posting/account-lock";
import { validatePostForResolvedAccounts } from "@/lib/validation/post-validation";
import { validateXLongPostAccess } from "@/lib/validation/x-long-post";
import type { ConnectedAccount } from "@/types";

jest.mock("@/lib/logger", () => ({ createLogger: () => ({ warn: jest.fn() }) }));
jest.mock("@/lib/config", () => ({
  getPlatformById: (id: string) => ({ id, name: id }),
  isSocialPlatformEnabled: () => true,
}));
jest.mock("@/lib/oauth/credential-health", () => ({ refreshConnectedAccountIfNeeded: jest.fn() }));
jest.mock("@/lib/posting/account-lock", () => ({
  reloadAccountSecrets: jest.fn(),
  withAccountLock: async (_id: string, fn: () => Promise<unknown>) => fn(),
}));

const account = { id: "x-account", platform: "x", username: "test", accessToken: "" } as ConnectedAccount;
const originalFetch = globalThis.fetch;
const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = fetchMock;
  jest.mocked(reloadAccountSecrets).mockResolvedValue(account);
  jest.mocked(refreshConnectedAccountIfNeeded).mockResolvedValue({
    account: { ...account, accessToken: "fresh-token" },
  } as Awaited<ReturnType<typeof refreshConnectedAccountIfNeeded>>);
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

const validate = (message = "日".repeat(141), thread?: { message: string }[]) =>
  validatePostForResolvedAccounts({ message, media: [], accounts: [account], thread });

it("blocks each overweight root/reply before publishing when the account has no Premium", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { subscription_type: "None" } }) });
  const validation = validate(undefined, [{ message: "日".repeat(150) }]);
  await validateXLongPostAccess(validation);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer fresh-token");
  expect(validation.summary.isValid).toBe(false);
  expect(validation.summary.warnings).toEqual([]);
  expect(validation.summary.errors).toEqual([
    expect.objectContaining({
      code: "long_post_requires_premium",
      actual: 282,
      field: "text",
      meta: { accountId: account.id },
    }),
    expect.objectContaining({ code: "long_post_requires_premium", actual: 300, field: "thread[0]" }),
  ]);
  expect(validation.accounts[0].accessToken).toBe("");
});

it.each(["Basic", "Premium", "PremiumPlus", undefined, "future-tier"])(
  "keeps long-post support for %s",
  async (subscription_type) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { subscription_type } }) });
    const validation = validate();
    await validateXLongPostAccess(validation);
    expect(validation.summary.isValid).toBe(true);
    expect(validation.summary.warnings[0].code).toBe("long_post");
  },
);

it("does not contact X for text within the weighted limit", async () => {
  const validation = validate("日".repeat(140));
  await validateXLongPostAccess(validation);
  expect(reloadAccountSecrets).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("validates an account override rather than the unused shared text", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { subscription_type: "None" } }) });
  const validation = validatePostForResolvedAccounts({
    message: "Short",
    media: [],
    accounts: [account],
    accountOverrides: { [account.id]: { message: "日".repeat(141), thread: [{ message: "Reply" }] } },
  });
  await validateXLongPostAccess(validation);
  expect(validation.summary.errors[0]).toMatchObject({ actual: 282, field: "text" });
});

it("retains the warning if the profile request fails", async () => {
  fetchMock.mockRejectedValue(new Error("Unavailable"));
  const validation = validate();
  await validateXLongPostAccess(validation);
  expect(validation.summary.isValid).toBe(true);
  expect(validation.summary.warnings[0].actual).toBe(282);
});

it("does not issue a profile request when safe credential refresh fails", async () => {
  jest
    .mocked(refreshConnectedAccountIfNeeded)
    .mockResolvedValue({ account, error: "Reconnect" } as Awaited<ReturnType<typeof refreshConnectedAccountIfNeeded>>);
  const validation = validate();
  await validateXLongPostAccess(validation);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(validation.summary.warnings[0].code).toBe("long_post");
});
