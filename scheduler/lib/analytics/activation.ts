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
  reportedKinds: string[];
}

export interface MilestoneEvent {
  kind: MilestoneKind;
  name: string;
  props: Record<string, string>;
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
  return RELAYED_MILESTONES.filter(({ kind, field }) => row[field] && !reported.has(kind)).map(({ kind, event }) => {
    const props: Record<string, string> = { ...landing };
    if (kind === "ai_connected") props.client = normalizeAiClient(row.aiClient);
    if (kind === "social_connected") props.platform = normalizePlatform(row.socialPlatform);
    return { kind, name: event, props };
  });
}

/**
 * Claim pending milestones at most once. Two tabs racing to claim the same row cannot
 * both succeed because the update only applies to the `reportedKinds` value read here.
 * A claimed event that the browser then fails to deliver is not retried: the database
 * row remains the authoritative record, and analytics may undercount but never repeat.
 */
export async function claimMilestoneEvents(userId: string): Promise<MilestoneEvent[]> {
  const [row, user] = await Promise.all([
    prisma.activationMilestone.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { acquisition: true } }),
  ]);
  if (!row || !user) return [];
  const events = unreportedMilestones(row, user.acquisition);
  if (events.length === 0) return [];
  const claimed = await prisma.activationMilestone.updateMany({
    where: { userId, reportedKinds: { equals: row.reportedKinds } },
    data: { reportedKinds: [...row.reportedKinds, ...events.map((event) => event.kind)] },
  });
  return claimed.count === 1 ? events : [];
}
