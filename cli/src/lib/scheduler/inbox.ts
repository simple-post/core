import { fetchSchedulerApi, getSchedulerContext } from "./client.js";

import { PromptSession } from "../ux/prompt.js";

export interface InboxItem {
  id: string;
  platform: string;
  kind: "comment" | "reply" | "quote";
  accountName: string;
  body: string;
  nativeUrl?: string;
  author?: { name?: string; username?: string };
  canLike: boolean;
  canReply: boolean;
  liked: boolean;
}

export interface InboxPage {
  items: InboxItem[];
  accounts: { platform: string; name: string; canSync: boolean; error?: string; permissionUrl?: string }[];
  nextCursor?: string;
}

export interface InboxReceipt {
  status: "pending" | "sent" | "failed" | "uncertain";
  errorMessage?: string;
  nativeReplyUrl?: string;
}

export interface InboxRefresh {
  accounts: { platform: string; processed: number; hasMore: boolean; error?: string }[];
  hasMore: boolean;
}

export async function inboxApi<T>(configDir: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const context = await getSchedulerContext(configDir, new PromptSession());
  return fetchSchedulerApi<T>(context, `/api/v1/social/${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}
