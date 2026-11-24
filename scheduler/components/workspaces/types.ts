import type { Snapshot, Variant, WorkspaceCommand } from "@/lib/workspaces/contracts";
export type WorkspaceIndex = {
  workspaces: { id: string; name: string; icon: string }[];
  limit: number;
  owned: number;
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
    deliveries: { id: string; status: string }[];
  }[];
  events: { id: string; kind: string; body: string; actorName: string; createdAt: string; reviewId: string | null }[];
};
export type FileInfo = { id: string; filename: string; mime: string };
export type Workspace = {
  id: string;
  name: string;
  icon: string;
  description: string;
  creatorId: string;
  member: { userId: string; role: string; approver: boolean };
  states: { id: string; name: string; kind: string; position: number }[];
  members: Member[];
  posts: Item[];
  files: FileInfo[];
  accounts: { id: string; platform: string; displayName: string | null; username: string | null }[];
  invites: { id: string; email: string; role: string }[];
};
export type Run = (cmd: WorkspaceCommand) => Promise<boolean>;
export const platformName: Record<Variant["platform"], string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};
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
