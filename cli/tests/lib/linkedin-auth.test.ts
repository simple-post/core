import { fetchLinkedInMemberProfile, fetchLinkedInPages } from "@simple-post/sdk";

import { chooseLinkedInAccount } from "../../src/lib/auth/linkedin.js";
import { createEmptyCliConfig } from "../../src/lib/config.js";
import { CredentialResolver } from "../../src/lib/credentials.js";

import type { AuthProviderContext } from "../../src/lib/auth/provider.js";
import type { SecretStore } from "../../src/lib/secrets.js";

jest.mock("@simple-post/sdk", () => ({ fetchLinkedInMemberProfile: jest.fn(), fetchLinkedInPages: jest.fn() }));

const prompt = { interactive: true, select: jest.fn(), log: jest.fn() };
const contextPrompt = prompt as unknown as AuthProviderContext["prompt"];

beforeEach(() => {
  jest.clearAllMocks();
  prompt.interactive = true;
  (fetchLinkedInMemberProfile as jest.Mock).mockResolvedValue({ sub: "member", name: "Member" });
  (fetchLinkedInPages as jest.Mock).mockResolvedValue([
    { id: "urn:li:organization:123", name: "Company", username: "company" },
  ]);
});

it("connects the selected Page instead of the member who authorized it", async () => {
  prompt.select.mockResolvedValue("urn:li:organization:123");
  await expect(chooseLinkedInAccount("token", contextPrompt)).resolves.toMatchObject({
    userId: "urn:li:organization:123",
    displayName: "Company",
    secretPayload: { tokenMetadata: { linkedinMemberId: "member" } },
  });
});

it("preserves personal-profile selection", async () => {
  prompt.select.mockResolvedValue("member");
  await expect(chooseLinkedInAccount("token", contextPrompt)).resolves.toMatchObject({ userId: "member" });
});

it("keeps non-interactive login on the personal profile", async () => {
  prompt.interactive = false;
  await expect(chooseLinkedInAccount("token", contextPrompt)).resolves.toMatchObject({ userId: "member" });
  expect(fetchLinkedInPages).not.toHaveBeenCalled();
});

it("provides guidance and keeps the profile available if Page discovery fails", async () => {
  (fetchLinkedInPages as jest.Mock).mockRejectedValue(new Error("403"));
  await expect(chooseLinkedInAccount("token", contextPrompt)).resolves.toMatchObject({ userId: "member" });
  expect(prompt.log).toHaveBeenCalledWith(expect.stringContaining("Page permissions"));
});

it.each(["member", "urn:li:organization:123"])(
  "resolves stored %s identity into the correct SDK destination",
  async (userId) => {
    const config = createEmptyCliConfig();
    config.linkedin.accounts.push({
      alias: "test",
      userId,
      secretRef: "secret",
      connectedAt: "2026-09-09",
      updatedAt: "2026-09-09",
    });
    const store = {
      read: jest.fn().mockResolvedValue({
        accessToken: "token",
        refreshToken: "refresh",
        tokenMetadata: { linkedinMemberId: "member" },
      }),
    } as unknown as SecretStore;
    const resolver = new CredentialResolver(config, store);
    const resolved = await resolver.resolveAccount("linkedin", "test");
    expect(resolved.postOptions.linkedin?.credentials).toEqual(
      userId === "member"
        ? { accessToken: "token", memberId: "member" }
        : { accessToken: "token", organizationId: "123" },
    );
  },
);
