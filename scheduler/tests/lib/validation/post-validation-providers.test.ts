import { isSocialPlatformEnabled } from "@/lib/config";
import { validatePostForResolvedAccounts } from "@/lib/validation/post-validation";
import type { ConnectedAccount } from "@/types";

jest.mock("@/lib/config", () => ({
  getPlatformById: (platform: string) => ({ id: platform, name: "X (Twitter)" }),
  isSocialPlatformEnabled: jest.fn(),
}));

const isSocialPlatformEnabledMock = isSocialPlatformEnabled as jest.MockedFunction<typeof isSocialPlatformEnabled>;

const account: ConnectedAccount = {
  id: "account-1",
  userId: "user-1",
  platform: "x",
  platformAccountId: "x-1",
  accessToken: "secret",
  refreshToken: null,
  tokenType: null,
  expiresAt: null,
  scope: null,
  username: "vlad",
  displayName: "Vlad",
  email: null,
  profilePicture: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

beforeEach(() => {
  jest.clearAllMocks();
});

it("returns a provider_disabled error for accounts disabled in this environment", () => {
  isSocialPlatformEnabledMock.mockReturnValue(false);

  const validation = validatePostForResolvedAccounts({ message: "Hello", media: [], accounts: [account] });

  expect(validation.summary.isValid).toBe(false);
  expect(validation.summary.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "provider_disabled", field: "accounts", meta: { accountId: "account-1" } }),
    ]),
  );
});

it("does not add a provider_disabled error when the provider is enabled", () => {
  isSocialPlatformEnabledMock.mockReturnValue(true);

  const validation = validatePostForResolvedAccounts({ message: "Hello", media: [], accounts: [account] });

  expect(validation.summary.errors).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "provider_disabled" })]),
  );
});
