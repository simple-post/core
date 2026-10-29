import { acquisitionLabels } from "./report";

const DAY = 86_400_000;
type Milestones = {
  aiConnectedAt?: Date | null;
  socialConnectedAt?: Date | null;
  firstPostScheduledAt?: Date | null;
  firstToolCalledAt?: Date | null;
  firstToolSucceededAt?: Date | null;
  firstPostAttemptedAt?: Date | null;
  firstPostCreatedAt?: Date | null;
  firstPostPublishedAt?: Date | null;
  secondPublishingDayAt?: Date | null;
  reportedKinds?: string[];
  relayLeaseExpiresAt?: Date | null;
  relayLastError?: string | null;
  relayAttempts?: number;
};
export interface CohortAccount {
  createdAt: Date;
  acquisition: unknown;
  lastNonDirectAcquisition?: unknown;
  activationMilestone: Milestones | null;
  freeTrial: { startsAt: Date; expiresAt: Date } | null;
  firstPayment: { paidAt: Date; attributionSnapshot?: string | null } | null;
  subscription: { status: string } | null;
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
const label = (value: unknown) => (typeof value === "string" && value.length <= 100 ? value : "unknown");
const STAGES = {
  aiConnected: "aiConnectedAt",
  socialConnected: "socialConnectedAt",
  toolCalled: "firstToolCalledAt",
  toolSucceeded: "firstToolSucceededAt",
  postAttempted: "firstPostAttemptedAt",
  postCreated: "firstPostCreatedAt",
  postScheduled: "firstPostScheduledAt",
  published: "firstPostPublishedAt",
  repeatPublished: "secondPublishingDayAt",
} as const;
export function buildCohortReport(
  accounts: readonly CohortAccount[],
  options: {
    now?: Date;
    windowDays?: 1 | 7 | 14 | 30;
    trialGraceDays?: 0 | 7 | 14;
    attribution?: "first" | "last_non_direct";
  } = {},
) {
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? 7;
  const grace = options.trialGraceDays ?? 7;
  const rows = new Map<string, ReturnType<typeof makeRow>>();
  function makeRow(dimensions: {
    source: string;
    medium: string;
    campaign: string;
    content: string;
    landingPage: string;
    entrypoint: string;
    signupVersion: string;
    onboardingVersion: string;
    measurementVersion: string;
    trialOffer: string;
    trialDays: string;
  }) {
    return {
      ...dimensions,
      signups: 0,
      eligible: 0,
      immature: 0,
      aiConnected: 0,
      socialConnected: 0,
      toolCalled: 0,
      toolSucceeded: 0,
      postAttempted: 0,
      postCreated: 0,
      postScheduled: 0,
      published: 0,
      repeatPublished: 0,
      paid: 0,
      expiredTrialEligible: 0,
      trialPaid: 0,
      expiredUnpaidNoSocial: 0,
      expiredUnpaidSocialNoPublish: 0,
      expiredUnpaidPublished: 0,
    };
  }
  const quality = {
    signups: 0,
    unknownSource: 0,
    directSource: 0,
    taggedCampaign: 0,
    latestNonDirectKnown: 0,
    versioned: 0,
    missingMilestones: 0,
    relayPendingUsers: 0,
    relayFailedUsers: 0,
    relayLeasedUsers: 0,
  };
  for (const account of accounts) {
    if (account.createdAt > now) continue;
    const data = object(account.acquisition);
    const first = acquisitionLabels(account.acquisition);
    // Last non-direct at signup is a frozen acquisition cohort, not a later reactivation or payment redirect.
    const source = acquisitionLabels(account.acquisition, options.attribution ?? "first");
    const duration = account.freeTrial
      ? Math.round(((account.freeTrial.expiresAt.getTime() - account.freeTrial.startsAt.getTime()) / DAY) * 10) / 10
      : null;
    const dimensions = {
      source: source.source,
      medium: source.medium,
      campaign: source.campaign,
      content: source.content,
      landingPage: source.landingPage,
      entrypoint: label(data.signupEntryPoint),
      signupVersion: label(data.signupVersion),
      onboardingVersion: label(data.onboardingVersion),
      measurementVersion: label(data.measurementVersion),
      trialOffer: label(data.trialOffer ?? "standard"),
      trialDays: duration === null ? "none" : String(duration),
    };
    const key = JSON.stringify(dimensions);
    const row = rows.get(key) ?? makeRow(dimensions);
    rows.set(key, row);
    row.signups++;
    quality.signups++;
    if (first.source === "unknown") quality.unknownSource++;
    if (first.source === "direct") quality.directSource++;
    if (source.campaign !== "—") quality.taggedCampaign++;
    if (data.lastNonDirect || account.lastNonDirectAcquisition) quality.latestNonDirectKnown++;
    if (data.measurementVersion === "funnel-v2") quality.versioned++;
    const milestone = account.activationMilestone;
    if (!milestone) quality.missingMilestones++;
    if (data.measurementVersion === "funnel-v2" && milestone) {
      if (milestone.relayLastError) quality.relayFailedUsers++;
      if (milestone.relayLeaseExpiresAt && milestone.relayLeaseExpiresAt > now) quality.relayLeasedUsers++;
      const kinds: Array<[string, Date | null | undefined]> = [
        ["post_scheduled", milestone.firstPostScheduledAt],
        ["signup_completed", account.createdAt],
        ["ai_connected", milestone.aiConnectedAt],
        ["social_connected", milestone.socialConnectedAt],
        ["post_created", milestone.firstPostCreatedAt],
        ["post_published", milestone.firstPostPublishedAt],
        ["tool_called", milestone.firstToolCalledAt],
        ["tool_succeeded", milestone.firstToolSucceededAt],
        ["post_attempted", milestone.firstPostAttemptedAt],
        ["repeat_published", milestone.secondPublishingDayAt],
      ];
      if (kinds.some(([kind, at]) => at && at <= now && !milestone.reportedKinds?.includes(kind)))
        quality.relayPendingUsers++;
    }
    const deadline = new Date(account.createdAt.getTime() + windowDays * DAY);
    const reached = (at: Date | null | undefined, end: Date) => !!at && at >= account.createdAt && at <= end;
    if (deadline <= now) {
      row.eligible++;
      for (const [metric, field] of Object.entries(STAGES) as Array<
        [keyof typeof STAGES, (typeof STAGES)[keyof typeof STAGES]]
      >)
        if (reached(milestone?.[field], deadline)) row[metric]++;
      if (reached(account.firstPayment?.paidAt, deadline)) row.paid++;
    } else row.immature++;
    if (account.freeTrial) {
      const expiry = account.freeTrial.expiresAt;
      const paymentDeadline = new Date(expiry.getTime() + grace * DAY);
      if (paymentDeadline <= now) {
        row.expiredTrialEligible++;
        if (reached(account.firstPayment?.paidAt, paymentDeadline)) row.trialPaid++;
        else if (reached(milestone?.firstPostPublishedAt, expiry)) row.expiredUnpaidPublished++;
        else if (reached(milestone?.socialConnectedAt, expiry)) row.expiredUnpaidSocialNoPublish++;
        else row.expiredUnpaidNoSocial++;
      }
    }
  }
  return {
    asOf: now.toISOString(),
    windowDays,
    trialGraceDays: grace,
    attribution: options.attribution ?? "first",
    quality,
    definitions: {
      fixedWindow:
        "Only signups with the full observation window are eligible; milestones occur between signup and its deadline. Counts are parallel account milestones, not a mandatory sequence.",
      trial:
        "Expired trial eligibility uses each actual expiry plus the selected payment grace. Unpaid stages are classified at actual trial expiry.",
      attribution:
        "First touch is immutable. last_non_direct selects the identifiable touch frozen at signup; later touches and first-payment snapshots are stored separately.",
      sourceEvidence:
        "Client names and browser attribution are metadata, not verified acquisition or listing-impression evidence.",
      history:
        "Unknown versions and missing historical milestones remain visible. Old deletion-biased records are not fabricated. Relay quality is measured only for funnel-v2 accounts.",
    },
    rows: [...rows.values()].sort((a, b) => b.signups - a.signups),
  };
}
