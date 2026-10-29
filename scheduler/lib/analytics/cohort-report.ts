import { acquisitionLabels } from "./report";
const DAY = 86_400_000;
export const COHORT_GROUPS = ["source", "campaign", "entrypoint", "landing_page", "trial_days", "signup_week"] as const;
export type CohortGroup = (typeof COHORT_GROUPS)[number];
type Milestones = {
  aiConnectedAt?: Date | null;
  socialConnectedAt?: Date | null;
  firstPostCreatedAt?: Date | null;
  firstPostScheduledAt?: Date | null;
  firstPostPublishedAt?: Date | null;
  firstToolCalledAt?: Date | null;
  firstToolSucceededAt?: Date | null;
  firstPostAttemptedAt?: Date | null;
  secondPublishingDayAt?: Date | null;
};
export interface CohortAccount {
  createdAt: Date;
  acquisition: unknown;
  activationMilestone: Milestones | null;
  freeTrial: { startsAt: Date; expiresAt: Date } | null;
  firstPayment: { paidAt: Date } | null;
}
function metadata(value: unknown): Record<string, unknown> {
  try {
    if (typeof value === "string") value = JSON.parse(value);
  } catch {
    return {};
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
const stages = {
  aiConnected: "aiConnectedAt",
  socialConnected: "socialConnectedAt",
  postCreated: "firstPostCreatedAt",
  postScheduled: "firstPostScheduledAt",
  published: "firstPostPublishedAt",
} as const;
const newStages = {
  toolCalled: "firstToolCalledAt",
  toolSucceeded: "firstToolSucceededAt",
  postAttempted: "firstPostAttemptedAt",
  repeatPublished: "secondPublishingDayAt",
} as const;
function counters() {
  return {
    signups: 0,
    eligible: 0,
    immature: 0,
    newStageEligible: 0,
    noTrial: 0,
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
export function buildCohortReport(
  accounts: readonly CohortAccount[],
  options: {
    now?: Date;
    windowDays?: 1 | 7 | 14 | 30;
    trialGraceDays?: 0 | 7 | 14;
    attribution?: "first" | "last_non_direct";
    groupBy?: CohortGroup;
  } = {},
) {
  const now = options.now ?? new Date(),
    windowDays = options.windowDays ?? 7,
    grace = options.trialGraceDays ?? 7,
    groupBy = options.groupBy ?? "source";
  const totals = counters(),
    rows = new Map<string, ReturnType<typeof counters> & { dimensions: Record<string, string> }>();
  const quality = {
    signups: 0,
    unknownSource: 0,
    directSource: 0,
    taggedCampaign: 0,
    versioned: 0,
    missingMilestones: 0,
  };
  for (const account of accounts) {
    if (account.createdAt > now) continue;
    const data = metadata(account.acquisition),
      first = acquisitionLabels(account.acquisition),
      source = acquisitionLabels(account.acquisition, options.attribution ?? "first");
    const entrypoint = typeof data.signupEntryPoint === "string" ? data.signupEntryPoint : "unknown";
    const versioned = data.measurementVersion === "funnel-v2";
    const selectedTouch =
      options.attribution === "last_non_direct" && data.lastNonDirect ? metadata(data.lastNonDirect) : data;
    const sourceLabel =
      entrypoint === "assistant_authorize" && source.landingPage === "/app" && selectedTouch.sourceMethod === "referrer"
        ? `${source.source} (authorization)`
        : source.source;
    const duration = account.freeTrial
      ? String(
          Math.round(((account.freeTrial.expiresAt.getTime() - account.freeTrial.startsAt.getTime()) / DAY) * 10) / 10,
        )
      : "none";
    const week = new Date(account.createdAt);
    week.setUTCHours(0, 0, 0, 0);
    week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
    const dimensions: Record<string, string> =
      groupBy === "source"
        ? { source: sourceLabel, entrypoint }
        : groupBy === "campaign"
          ? { source: source.source, entrypoint, medium: source.medium, campaign: source.campaign }
          : groupBy === "entrypoint"
            ? { entrypoint }
            : groupBy === "landing_page"
              ? { landingPage: source.landingPage }
              : groupBy === "trial_days"
                ? { trialDays: duration }
                : { signupWeek: week.toISOString().slice(0, 10) };
    const key = JSON.stringify(dimensions),
      row = rows.get(key) ?? { dimensions, ...counters() };
    rows.set(key, row);
    const count = (field: keyof ReturnType<typeof counters>) => {
      row[field]++;
      totals[field]++;
    };
    count("signups");
    quality.signups++;
    if (first.source === "unknown") quality.unknownSource++;
    if (first.source === "direct") quality.directSource++;
    if (source.campaign !== "—") quality.taggedCampaign++;
    if (versioned) quality.versioned++;
    if (!account.activationMilestone) quality.missingMilestones++;
    if (!account.freeTrial) count("noTrial");
    const reached = (at: Date | null | undefined, end: Date) => !!at && at >= account.createdAt && at <= end;
    const deadline = new Date(account.createdAt.getTime() + windowDays * DAY);
    if (deadline <= now) {
      count("eligible");
      for (const [metric, field] of Object.entries(stages) as Array<
        [keyof typeof stages, (typeof stages)[keyof typeof stages]]
      >)
        if (reached(account.activationMilestone?.[field], deadline)) count(metric);
      if (versioned) {
        count("newStageEligible");
        for (const [metric, field] of Object.entries(newStages) as Array<
          [keyof typeof newStages, (typeof newStages)[keyof typeof newStages]]
        >)
          if (reached(account.activationMilestone?.[field], deadline)) count(metric);
      }
      if (reached(account.firstPayment?.paidAt, deadline)) count("paid");
    } else count("immature");
    if (account.freeTrial) {
      const expiry = account.freeTrial.expiresAt,
        paymentDeadline = new Date(expiry.getTime() + grace * DAY);
      if (paymentDeadline <= now) {
        count("expiredTrialEligible");
        if (reached(account.firstPayment?.paidAt, paymentDeadline)) count("trialPaid");
        else if (reached(account.activationMilestone?.firstPostPublishedAt, expiry)) count("expiredUnpaidPublished");
        else if (reached(account.activationMilestone?.socialConnectedAt, expiry)) count("expiredUnpaidSocialNoPublish");
        else count("expiredUnpaidNoSocial");
      }
    }
  }
  return {
    asOf: now.toISOString(),
    windowDays,
    trialGraceDays: grace,
    attribution: options.attribution ?? "first",
    groupBy,
    totals,
    quality,
    definitions: {
      fixedWindow:
        "Only signups with the full window are eligible; counts are parallel milestones by signup plus the window, not a mandatory sequence.",
      newStages:
        "toolCalled, toolSucceeded, postAttempted and repeatPublished are prospective funnel-v2 stages: use newStageEligible as their denominator. Earlier cohorts are unknown, not zero-use.",
      trial:
        "Actual trial expiry plus grace determines eligibility/payment deadline; unpaid stages are measured at expiry. noTrial is all signups without a trial row.",
      attribution:
        "First touch or last identifiable touch frozen at signup; source grouping also separates signup entry. Referrer-only assistant authorization is observed entry traffic, not verified discovery or featuring.",
      history:
        "Historical missing/deleted milestones are not fabricated. Compare matched signup dates; newly captured stages cannot explain pre-rollout history.",
    },
    rows: [...rows.values()].sort((a, b) => b.signups - a.signups),
  };
}
