export interface AcquisitionAccount {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  acquisition: unknown;
  freeTrial: { startsAt: Date; expiresAt: Date } | null;
  firstPayment: { paidAt: Date; planKey: string | null } | null;
  subscription: { status: string; planKey: string | null } | null;
}

export function acquisitionLabels(value: unknown) {
  // Better Auth's Prisma adapter stores JSON additional fields as serialized text.
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    source: typeof data.source === "string" ? data.source : "unknown",
    medium: typeof data.medium === "string" ? data.medium : "—",
    campaign: typeof data.campaign === "string" ? data.campaign : "—",
    landingPage: typeof data.landingPage === "string" ? data.landingPage : "—",
    firstSeenAt: typeof data.firstSeenAt === "string" ? data.firstSeenAt : null,
  };
}

export function buildAcquisitionReport(accounts: AcquisitionAccount[], now = new Date()) {
  const groups = new Map<
    string,
    {
      source: string;
      medium: string;
      campaign: string;
      signups: number;
      trials: number;
      paid: number;
      trialPaid: number;
      running: number;
      matureTrials: number;
      maturePaid: number;
    }
  >();
  for (const account of accounts) {
    const labels = acquisitionLabels(account.acquisition);
    const key = JSON.stringify([labels.source, labels.medium, labels.campaign]);
    const group = groups.get(key) || {
      source: labels.source,
      medium: labels.medium,
      campaign: labels.campaign,
      signups: 0,
      trials: 0,
      paid: 0,
      trialPaid: 0,
      running: 0,
      matureTrials: 0,
      maturePaid: 0,
    };
    const paid = !!account.firstPayment && account.firstPayment.paidAt <= now;
    group.signups++;
    if (paid) group.paid++;
    if (account.freeTrial && account.freeTrial.startsAt <= now) {
      group.trials++;
      if (paid) group.trialPaid++;
      if (account.freeTrial.expiresAt <= now) {
        group.matureTrials++;
        if (paid) group.maturePaid++;
      } else if (!paid) group.running++;
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((row) => ({ ...row, matureConversionRate: row.matureTrials ? row.maturePaid / row.matureTrials : null }))
    .sort((a, b) => b.paid - a.paid || b.trials - a.trials || a.source.localeCompare(b.source));
}

export function isAnalyticsAdmin(user: { isAdmin: boolean; emailVerified: boolean } | null | undefined): boolean {
  return user?.isAdmin === true && user.emailVerified === true;
}

/** Cohorts are selected by signup date, not by payment date. UTC, inclusive end date. */
export function cohortRange(from?: string, to?: string, now = new Date()) {
  function day(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Choose valid signup dates.");
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
      throw new Error("Choose valid signup dates.");
    return date;
  }
  const endDay = to || now.toISOString().slice(0, 10);
  const startDay = from || new Date(now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
  const start = day(startDay);
  const end = new Date(day(endDay).getTime() + 86_400_000);
  if (end <= start || end.getTime() - start.getTime() > 366 * 86_400_000)
    throw new Error("Choose a signup cohort of 1–366 days.");
  return { start, end, from: startDay, to: endDay };
}
