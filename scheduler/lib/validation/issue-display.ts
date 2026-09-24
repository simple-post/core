import { getAccountDisplayName, getPlatformById } from "@/lib/config";
import type { ConnectedAccount } from "@/types";

import type { ValidationIssue } from "@simple-post/sdk";

type DisplayAccount = Pick<
  ConnectedAccount,
  "id" | "platform" | "username" | "displayName" | "email" | "platformAccountId"
>;

export interface ValidationIssueGroup {
  key: string;
  /** Account name, or null for post-level issues that apply to every account. */
  accountName: string | null;
  platform: string | null;
  platformName: string | null;
  messages: string[];
}

// Issue messages double as instructions for API and MCP clients. These codes
// carry developer guidance there, so the UI shows a plain-language version.
const UI_MESSAGES: Record<string, string> = {
  tiktok_privacy_status_required: "Choose who can see this post.",
  tiktok_commercial_disclosure_required: "Say whether this post promotes your own brand, a third party, or both.",
  tiktok_branded_content_private: "Branded content can't be set to “Only me”.",
};

function getIssueAccountId(issue: ValidationIssue): string | undefined {
  const accountId = issue.meta?.accountId;
  return typeof accountId === "string" ? accountId : undefined;
}

function getThreadPostNumber(field: string | undefined): number | null {
  const match = field?.match(/^thread\[(\d+)\]/);
  // thread[0] is the first reply; the main post is post 1.
  return match ? Number(match[1]) + 2 : null;
}

export function getIssueDisplayMessage(issue: ValidationIssue): string {
  const message = UI_MESSAGES[issue.code] ?? issue.message;
  const threadPost = getThreadPostNumber(issue.field);
  return threadPost ? `Post ${threadPost} in thread: ${message}` : message;
}

export function groupValidationIssues(
  issues: ValidationIssue[],
  accounts: DisplayAccount[] = [],
): ValidationIssueGroup[] {
  const groups = new Map<string, ValidationIssueGroup>();

  for (const issue of issues) {
    const account = accounts.find((candidate) => candidate.id === getIssueAccountId(issue));
    const platformName =
      issue.platform === "common" ? null : (getPlatformById(issue.platform)?.name ?? issue.platform.toUpperCase());
    const key = account ? `account:${account.id}` : `platform:${issue.platform}`;
    const group = groups.get(key) ?? {
      key,
      accountName: account ? getAccountDisplayName(account) : null,
      platform: issue.platform === "common" ? null : issue.platform,
      platformName,
      messages: [],
    };

    const message = getIssueDisplayMessage(issue);
    if (!group.messages.includes(message)) {
      group.messages.push(message);
    }
    groups.set(key, group);
  }

  // Post-level issues first: they usually block every account.
  return [...groups.values()].sort((a, b) => Number(b.platform === null) - Number(a.platform === null));
}
