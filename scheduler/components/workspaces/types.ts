import type { WorkspaceColor } from "@/lib/workspaces/colors";
import type { Snapshot, Variant, WorkspaceCommand } from "@/lib/workspaces/contracts";
export type WorkspaceIndex = {
  personal: { name: string; color: WorkspaceColor; logo?: string | null };
  workspaces: {
    id: string;
    name: string;
    icon: string;
    color: WorkspaceColor;
    logo?: string | null;
    role: string;
    canManage: boolean;
  }[];
  invites: { id: string; workspaceId: string; workspace: { name: string } }[];
};
export type Member = { userId: string; role: string; approver: boolean; user: { name: string; email: string } };
export type Item = Snapshot & {
  id: string;
  ownerId: string | null;
  dueAt: string | null;
  stateId: string;
  revision: number;
  currentReviewId: string | null;
  deliveredAt: string | null;
  reviews: {
    id: string;
    snapshot: Snapshot;
    requestedAt: string;
    requestedBy: string;
    outcome: string | null;
    decidedBy: string | null;
    deliveries: {
      id: string;
      status: string;
      accounts: { platform: string; displayName: string | null; username: string | null }[];
    }[];
  }[];
  events: { id: string; kind: string; body: string; actorName: string; createdAt: string; reviewId: string | null }[];
};
export type FileInfo = { id: string; filename: string; mime: string };
export type Workspace = {
  id: string;
  name: string;
  icon: string;
  color: WorkspaceColor;
  logo?: string | null;
  description: string;
  creatorId: string;
  member: { userId: string; role: string; approver: boolean };
  states: { id: string; name: string; kind: string; position: number }[];
  members: Member[];
  posts: Item[];
  files: FileInfo[];
  accounts: {
    id: string;
    platform: string;
    platformAccountId: string;
    displayName: string | null;
    username: string | null;
  }[];
  invites: { id: string; email: string; role: string; approver: boolean; emailSentAt?: string | null }[];
};
export type Run = (cmd: WorkspaceCommand) => Promise<boolean>;
export const platformName: Record<Variant["platform"], string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};
export function workspaceAccountForVariant(accounts: Workspace["accounts"], variant: Variant) {
  return accounts.find(
    (account) =>
      account.id === variant.accountId &&
      account.platform === variant.platform &&
      (!variant.destination || account.platformAccountId === variant.destination.platformAccountId),
  );
}
export function localTime(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
export function displayDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok && !response.headers.get("content-type")?.includes("application/json"))
    throw new Error(
      response.status === 413
        ? "The uploaded file is too large."
        : `Workspace request failed (HTTP ${response.status})`,
    );
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.error === "string" ? data.error : data.error?.message || data.message || "Workspace request failed",
    );
  return data as T;
}
export const json = (data: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

export function deliveryStatus(post: Item) {
  if (!post.deliveredAt) return "draft";
  if (post.variants.every((v) => !v.accountId)) return "published";
  const statuses = post.reviews.find((r) => r.id === post.currentReviewId)?.deliveries.map((d) => d.status) ?? [];
  if (statuses.length === 0 || statuses.some((s) => s === "failed" || s === "partial")) return "failed";
  return statuses.every((s) => s === "published") ? "published" : "scheduled";
}

const deliveryLabels = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Delivery needs attention",
};

export function workspacePostStatus(workspace: Workspace, post: Item, snapshot: Snapshot) {
  const review = post.reviews.find((item) => item.id === post.currentReviewId);
  const missingPlatforms = snapshot.variants
    .filter((variant) => !variant.destination || !workspaceAccountForVariant(workspace.accounts, variant))
    .map((variant) => variant.platform);
  const stage = workspace.states.find((state) => state.id === post.stateId)?.name ?? "Draft";
  const delivery = deliveryStatus(post);
  let label = review?.outcome === "changes" ? "Changes requested" : stage;
  if (post.deliveredAt) {
    if (post.variants.every((variant) => !variant.accountId)) label = "Published outside SimplePost";
    else label = delivery === "failed" && !review?.deliveries.length ? "Canceled" : deliveryLabels[delivery];
  }
  return { label, missingPlatforms, timePassed: Date.parse(snapshot.plannedAt) <= Date.now() };
}
