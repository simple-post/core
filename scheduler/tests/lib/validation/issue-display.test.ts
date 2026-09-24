import { getIssueDisplayMessage, groupValidationIssues } from "@/lib/validation/issue-display";

import type { ValidationIssue } from "@simple-post/sdk";

const tiktok = {
  id: "tiktok-account",
  platform: "tiktok",
  platformAccountId: "tt",
  username: "creator",
  displayName: "Creator",
  email: null,
};

const issue = (overrides: Partial<ValidationIssue>): ValidationIssue => ({
  platform: "tiktok",
  severity: "error",
  code: "media_required",
  message: "TikTok posts require at least one media item.",
  meta: { accountId: tiktok.id },
  ...overrides,
});

describe("validation issue display", () => {
  it("replaces developer guidance with plain language", () => {
    expect(
      getIssueDisplayMessage(
        issue({
          code: "tiktok_privacy_status_required",
          message: 'Set accountOptions["tiktok-account"].privacyLevel; MCP clients can call get_tiktok_creator_info.',
        }),
      ),
    ).toBe("Choose who can see this post.");
  });

  it("names the thread post an issue belongs to", () => {
    expect(getIssueDisplayMessage(issue({ field: "thread[0].text", message: "Too long." }))).toBe(
      "Post 2 in thread: Too long.",
    );
    expect(getIssueDisplayMessage(issue({ field: "text", message: "Too long." }))).toBe("Too long.");
  });

  it("groups issues by account and puts post-level issues first", () => {
    const groups = groupValidationIssues(
      [
        issue({ code: "tiktok_privacy_status_required" }),
        issue({}),
        issue({}),
        issue({ platform: "common", code: "no_thread_capable_accounts", message: "No thread accounts.", meta: {} }),
      ],
      [tiktok],
    );

    expect(groups).toEqual([
      {
        key: "platform:common",
        accountName: null,
        platform: null,
        platformName: null,
        messages: ["No thread accounts."],
      },
      {
        key: "account:tiktok-account",
        accountName: "@creator",
        platform: "tiktok",
        platformName: "TikTok",
        messages: ["Choose who can see this post.", "TikTok posts require at least one media item."],
      },
    ]);
  });
});
