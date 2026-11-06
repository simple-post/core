import { getDisplayMessage, type DisplayMessage } from "@simple-post/sdk/validation";

import { sourceCopy, type SourceCopy } from "@/lib/i18n/source-copy";
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
function validationGuidance(code: string, copy: SourceCopy): string | undefined {
  switch (code) {
    case "tiktok_privacy_status_required":
      return copy("Choose who can see this post.");
    case "tiktok_commercial_disclosure_required":
      return copy("Say whether this post promotes your own brand, a third party, or both.");
    case "tiktok_branded_content_private":
      return copy("Branded content can't be set to “Only me”.");
  }
}

function renderIssue(message: DisplayMessage, copy: SourceCopy): string {
  const values = Object.fromEntries(
    Object.entries(message.values).map(([key, value]) => [
      key,
      typeof value === "object" ? renderIssue(value, copy) : value,
    ]),
  );
  return copy(message.source, values);
}

export function translatedIssueText(issue: ValidationIssue, copy?: SourceCopy): string {
  const descriptor = getDisplayMessage(issue);
  return copy && descriptor ? renderIssue(descriptor, copy) : issue.message;
}

function getIssueAccountId(issue: ValidationIssue): string | undefined {
  const accountId = issue.meta?.accountId;
  return typeof accountId === "string" ? accountId : undefined;
}

function getThreadPostNumber(field: string | undefined): number | null {
  const match = field?.match(/^thread\[(\d+)\]/);
  // thread[0] is the first reply; the main post is post 1.
  return match ? Number(match[1]) + 2 : null;
}

export function getIssueDisplayMessage(
  issue: ValidationIssue,
  uiCopy?: SourceCopy,
  validationCopy?: SourceCopy,
): string {
  const copy = uiCopy ?? sourceCopy;
  const message = validationGuidance(issue.code, copy) ?? translatedIssueText(issue, validationCopy);
  const threadPost = getThreadPostNumber(issue.field);
  return threadPost ? copy("Post {{number, number}} in thread: {{message}}", { number: threadPost, message }) : message;
}

export function groupValidationIssues(
  issues: ValidationIssue[],
  accounts: DisplayAccount[] = [],
  uiCopy?: SourceCopy,
  validationCopy?: SourceCopy,
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

    const message = getIssueDisplayMessage(issue, uiCopy, validationCopy);
    if (!group.messages.includes(message)) {
      group.messages.push(message);
    }
    groups.set(key, group);
  }

  // Post-level issues first: they usually block every account.
  return [...groups.values()].sort((a, b) => Number(b.platform === null) - Number(a.platform === null));
}
