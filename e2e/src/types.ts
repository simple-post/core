export const platforms = [
  "x",
  "telegram",
  "instagram",
  "facebook",
  "threads",
  "tiktok",
  "youtube",
  "pinterest",
  "linkedin",
  "bluesky",
  "forem",
] as const;
export type Platform = (typeof platforms)[number];
export const interfaces = ["mcp", "cli-app", "cli-local", "ui"] as const;
export type Interface = (typeof interfaces)[number];
export type Options = Record<string, string | boolean | number | string[] | null>;
export type MediaKey = "image" | "image2" | "webp" | "video" | "silentVideo";
export interface Scenario {
  id: string;
  platform: Platform;
  media: MediaKey[];
  message?: string;
  options: Options;
  tags: string[];
  interfaces: Interface[];
  mode?: "schedule" | "draft" | "draft-edit" | "cancel";
  expectedError?: string;
  expectedFields?: Options;
  thread?: string[];
  requirements?: string[];
  omitOptions?: string[];
  unsupportedReason?: string;
  input?: "flags" | "json" | "remote";
}
export interface Materialized extends Scenario {
  message: string;
  token: string;
  scheduledFor?: string;
  expectedText: string;
  expectedTitle?: string;
  expectedFields: Options;
}
export interface MediaFile {
  type: "image" | "video";
  url: string;
  filename: string;
  size: number;
  thumbnailUrl?: string;
  path: string;
  sha256: string;
  durationSec?: number;
}
export interface PostingResult {
  accountId?: string;
  platform?: string;
  success: boolean;
  postId?: string;
  postUrl?: string;
  message?: string;
  error?: string;
  threadResults?: PostingResult[];
}
export interface Receipt {
  simplePostId?: string;
  results: PostingResult[];
  savedOptions?: Options;
  status?: string;
  scheduledFor?: string;
}
export type Phase = "reserved" | "submitting" | "accepted" | "verified" | "failed" | "inconclusive" | "blocked";
export interface JournalEntry {
  key: string;
  digest: string;
  platform: Platform;
  interface: Interface;
  scenario: Materialized;
  accountId: string;
  phase: Phase;
  createdAt: string;
  updatedAt: string;
  receipt?: Receipt;
  error?: string;
  historicalErrors?: string[];
  evidence?: string[];
  cleanup: "not-created" | "review-external-post" | "pending-schedule" | "discarded";
}
