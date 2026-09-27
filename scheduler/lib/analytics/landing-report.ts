import { landingCategory } from "./landing-category";
import { acquisitionLabels } from "./report";

export interface LandingAccount {
  acquisition: unknown;
  firstPayment: { paidAt: Date } | null;
  activationMilestone: {
    socialConnectedAt: Date | null;
    aiConnectedAt: Date | null;
    firstPostCreatedAt: Date | null;
    firstPostScheduledAt: Date | null;
    firstPostPublishedAt: Date | null;
  } | null;
}

export interface LandingRow {
  key: string;
  signups: number;
  socialConnected: number;
  aiConnected: number;
  postCreated: number;
  postScheduled: number;
  postPublished: number;
  paid: number;
}

/** Category for a stored first-touch landing route; SEO sections map to their category. */
export function landingGroup(landingPage: string): string {
  if (landingPage === "—" || !landingPage.startsWith("/")) return "unknown";
  if (landingPage === "/") return "home";
  if (landingPage === "/app" || landingPage.startsWith("/app/")) return "app";
  return landingCategory(landingPage) ?? "other";
}

function add(rows: Map<string, LandingRow>, key: string, account: LandingAccount, now: Date) {
  const row = rows.get(key) ?? {
    key,
    signups: 0,
    socialConnected: 0,
    aiConnected: 0,
    postCreated: 0,
    postScheduled: 0,
    postPublished: 0,
    paid: 0,
  };
  const milestone = account.activationMilestone;
  const reached = (value: Date | null | undefined) => !!value && value <= now;
  row.signups++;
  if (reached(milestone?.socialConnectedAt)) row.socialConnected++;
  if (reached(milestone?.aiConnectedAt)) row.aiConnected++;
  if (reached(milestone?.firstPostCreatedAt)) row.postCreated++;
  if (reached(milestone?.firstPostScheduledAt)) row.postScheduled++;
  if (reached(milestone?.firstPostPublishedAt)) row.postPublished++;
  if (reached(account.firstPayment?.paidAt)) row.paid++;
  rows.set(key, row);
}

function sorted(rows: Map<string, LandingRow>) {
  return [...rows.values()].sort((a, b) => b.signups - a.signups || a.key.localeCompare(b.key));
}

/**
 * Signups grouped by first-touch landing category (platform, ai_client, guide, tool,
 * comparison, mcp, home, app, other, unknown) and by individual SEO landing page, with
 * how many reached each activation milestone. Milestones come from activation_milestone.
 */
export function buildLandingReport(accounts: readonly LandingAccount[], now = new Date()) {
  const categories = new Map<string, LandingRow>();
  const pages = new Map<string, LandingRow>();
  for (const account of accounts) {
    const { landingPage } = acquisitionLabels(account.acquisition);
    const group = landingGroup(landingPage);
    add(categories, group, account, now);
    if (!["home", "app", "other", "unknown"].includes(group)) add(pages, landingPage, account, now);
  }
  return { categories: sorted(categories), pages: sorted(pages).slice(0, 50) };
}

export function rate(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "—";
}
