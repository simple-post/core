import { createHash, randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";

import { landingCategory } from "./landing-category";
import { acquisitionLabels } from "./report";

/**
 * Activation milestones recorded by database triggers. Paid subscriptions are
 * measured by the existing verified "Paid Subscription" browser event, so the
 * subscription milestone is stored for reporting but never relayed again.
 */
export const RELAYED_MILESTONES = [
  { kind: "signup_completed", event: "Signup Completed", field: "signupCompletedAt" },
  { kind: "ai_connected", event: "AI Integration Connected", field: "aiConnectedAt" },
  { kind: "social_connected", event: "Social Account Connected", field: "socialConnectedAt" },
  { kind: "tool_called", event: "First Tool Called", field: "firstToolCalledAt" },
  { kind: "tool_succeeded", event: "First Tool Succeeded", field: "firstToolSucceededAt" },
  { kind: "post_attempted", event: "First Post Attempted", field: "firstPostAttemptedAt" },
  { kind: "repeat_published", event: "Second Publishing Day", field: "secondPublishingDayAt" },
  { kind: "post_created", event: "First Post Created", field: "firstPostCreatedAt" },
  { kind: "post_scheduled", event: "First Post Scheduled", field: "firstPostScheduledAt" },
  { kind: "post_published", event: "First Post Published", field: "firstPostPublishedAt" },
] as const;

export type MilestoneKind = (typeof RELAYED_MILESTONES)[number]["kind"] | "subscription_started";

export interface MilestoneRow {
  signupCompletedAt: Date | null;
  aiConnectedAt: Date | null;
  aiClient: string | null;
  socialConnectedAt: Date | null;
  socialPlatform: string | null;
  firstPostCreatedAt: Date | null;
  firstPostScheduledAt: Date | null;
  firstPostPublishedAt: Date | null;
  subscriptionStartedAt: Date | null;
  firstToolCalledAt?: Date | null;
  firstToolSucceededAt?: Date | null;
  firstPostAttemptedAt?: Date | null;
  secondPublishingDayAt?: Date | null;
  relayLeaseToken?: string | null;
  relayLeaseExpiresAt?: Date | null;
  reportedKinds: string[];
}

export interface MilestoneEvent {
  kind: MilestoneKind;
  name: string;
  props: Record<string, string>;
  occurredAt: string;
}

const KNOWN_PLATFORMS = new Set([
  "x",
  "twitter",
  "linkedin",
  "instagram",
  "facebook",
  "threads",
  "bluesky",
  "tiktok",
  "youtube",
  "pinterest",
  "telegram",
  "forem",
]);

/**
 * MCP client names are self-reported during dynamic registration. Only a fixed set of
 * labels is sent to analytics; anything else becomes "other-mcp".
 */
export function normalizeAiClient(name: string | null | undefined): string {
  const value = (name ?? "").toLowerCase();
  if (value === "simplepost cli") return "cli";
  if (value === "simplepost api") return "api";
  if (/claude[\s-]?code/.test(value)) return "claude-code";
  if (/chatgpt|openai/.test(value)) return "chatgpt";
  if (/claude|anthropic/.test(value)) return "claude";
  if (/cursor/.test(value)) return "cursor";
  if (/openclaw/.test(value)) return "openclaw";
  if (/gemini/.test(value)) return "gemini-cli";
  if (/hermes/.test(value)) return "hermes";
  if (/codex/.test(value)) return "codex";
  if (/windsurf|codeium/.test(value)) return "windsurf";
  if (/kiro/.test(value)) return "kiro";
  if (/grok/.test(value)) return "grok";
  return "other-mcp";
}

export function normalizePlatform(platform: string | null | undefined): string {
  const value = (platform ?? "").toLowerCase();
  if (value === "twitter") return "x";
  return KNOWN_PLATFORMS.has(value) ? value : "other";
}

/** Landing context attached to every relayed milestone. Public route names only. */
export function landingProps(acquisition: unknown): Record<string, string> {
  const { landingPage } = acquisitionLabels(acquisition);
  const page = landingPage.startsWith("/") ? landingPage : "unknown";
  return {
    landing_page: page,
    landing_category: page === "unknown" ? "unknown" : (landingCategory(page) ?? (page === "/" ? "home" : "other")),
  };
}

/** Milestones that have happened but have not been relayed to browser analytics yet. */
export function unreportedMilestones(row: MilestoneRow, acquisition: unknown): MilestoneEvent[] {
  const reported = new Set(row.reportedKinds);
  const landing = landingProps(acquisition);
  return RELAYED_MILESTONES.filter(({ kind, field }) => row[field] && !reported.has(kind)).map(
    ({ kind, event, field }) => {
      const props: Record<string, string> = { ...landing };
      if (kind === "ai_connected") props.client = normalizeAiClient(row.aiClient);
      if (kind === "social_connected") props.platform = normalizePlatform(row.socialPlatform);
      return { kind, name: event, props, occurredAt: row[field]!.toISOString() };
    },
  );
}

export interface MilestoneBatch {
  claimToken: string | null;
  events: Array<MilestoneEvent & { eventId: string }>;
}

/** Lease delivery; only an acknowledgement marks delivered kinds. DB timestamps remain authoritative. */
export async function claimMilestoneEvents(userId: string, now = new Date()): Promise<MilestoneBatch> {
  const empty: MilestoneBatch = { claimToken: null, events: [] };
  const [row, user] = await Promise.all([
    prisma.activationMilestone.findUnique({ where: { userId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { acquisition: true, isAdmin: true, analyticsExcluded: true },
    }),
  ]);
  if (
    !row ||
    !user ||
    user.isAdmin ||
    user.analyticsExcluded ||
    (row.relayLeaseExpiresAt && row.relayLeaseExpiresAt > now)
  )
    return empty;
  const events = unreportedMilestones(row, user.acquisition);
  if (events.length === 0) return empty;
  const claimToken = randomUUID();
  const claimed = await prisma.activationMilestone.updateMany({
    where: {
      userId,
      reportedKinds: { equals: row.reportedKinds },
      OR: [{ relayLeaseExpiresAt: null }, { relayLeaseExpiresAt: { lte: now } }],
    },
    data: {
      relayLeaseToken: claimToken,
      relayLeaseExpiresAt: new Date(now.getTime() + 120_000),
      relayAttempts: { increment: 1 },
      relayLastAttemptAt: now,
    },
  });
  return claimed.count === 1
    ? {
        claimToken,
        events: events.map((event) => ({
          ...event,
          eventId: createHash("sha256").update(`${userId}:${event.kind}`).digest("hex").slice(0, 32),
        })),
      }
    : empty;
}

/** Receipts belong to this user and lease. Unknown or unreached kinds can never be acknowledged. */
export async function acknowledgeMilestones(userId: string, token: string, delivered: string[]) {
  const row = await prisma.activationMilestone.findUnique({ where: { userId } });
  if (!row || row.relayLeaseToken !== token) return;
  const pending = RELAYED_MILESTONES.filter(({ field, kind }) => row[field] && !row.reportedKinds.includes(kind)).map(
    (x) => x.kind,
  );
  const accepted = pending.filter((kind) => delivered.includes(kind));
  await prisma.activationMilestone.updateMany({
    where: { userId, relayLeaseToken: token, reportedKinds: { equals: row.reportedKinds } },
    data: {
      reportedKinds: [...row.reportedKinds, ...accepted],
      relayLeaseToken: null,
      relayLeaseExpiresAt: null,
      relayLastError: accepted.length === pending.length ? null : "delivery_incomplete",
    },
  });
}
