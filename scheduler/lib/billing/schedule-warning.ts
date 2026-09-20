export const TRIAL_EXPIRY_SCHEDULE_WARNING = "TRIAL_EXPIRES_BEFORE_PUBLISH" as const;

export interface ScheduleWarning {
  code: typeof TRIAL_EXPIRY_SCHEDULE_WARNING;
  message: string;
  trialExpiresAt: string;
}

interface TrialScheduleBilling {
  accessType: string | null;
  trial: {
    status: "active" | "expired";
    expiresAt: string;
  } | null;
}

/**
 * Warn without blocking: active trial users may schedule beyond trial expiry,
 * but the dispatch-time billing gate will require a paid plan by then.
 */
export function getTrialExpiryScheduleWarning(
  billing: TrialScheduleBilling | null | undefined,
  scheduledFor: Date | string | null | undefined,
): ScheduleWarning | null {
  if (billing?.accessType !== "trial" || billing.trial?.status !== "active" || !scheduledFor) return null;

  const publishAt = scheduledFor instanceof Date ? scheduledFor : new Date(scheduledFor);
  const expiresAt = new Date(billing.trial.expiresAt);
  if (
    Number.isNaN(publishAt.getTime()) ||
    Number.isNaN(expiresAt.getTime()) ||
    publishAt.getTime() < expiresAt.getTime()
  ) {
    return null;
  }

  return {
    code: TRIAL_EXPIRY_SCHEDULE_WARNING,
    message:
      "This post is scheduled after your free trial ends. It will remain scheduled, but it will not publish unless you choose a plan before the scheduled time.",
    trialExpiresAt: expiresAt.toISOString(),
  };
}
