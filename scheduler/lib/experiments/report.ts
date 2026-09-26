const DAY = 86_400_000;
export type Exposure = { id: string; experimentId: string; variant: string; exposedAt: Date };
export type ExperimentAccount = {
  createdAt: Date;
  experimentAttribution: string | null;
  experimentMilestone: { firstConnectedAt: Date | null; firstPublishedAt: Date | null } | null;
  firstPayment: { paidAt: Date; amountPaid: number } | null;
};
export function attribution(
  value: string | null,
): { assignmentId: string; experimentId: string; variant: string } | null {
  try {
    const data = JSON.parse(value || "null");
    return data?.version === 1 && /^[a-f0-9]{64}$/.test(data.assignmentId) && ["a", "b"].includes(data.variant)
      ? data
      : null;
  } catch {
    return null;
  }
}
export function buildExperimentReport(exposures: Exposure[], accounts: ExperimentAccount[], now = new Date()) {
  const byId = new Map(exposures.map((exposure) => [exposure.id, exposure]));
  const signups = new Map<string, ExperimentAccount>();
  let unmatched = 0;
  let duplicateSignups = 0;
  let lateSignups = 0;
  for (const account of [...accounts].sort((a, b) => +a.createdAt - +b.createdAt)) {
    if (+account.createdAt > +now) continue;
    const data = attribution(account.experimentAttribution);
    const exposure = data && byId.get(data.assignmentId);
    if (
      !exposure ||
      data?.experimentId !== exposure.experimentId ||
      data.variant !== exposure.variant ||
      +account.createdAt < +exposure.exposedAt
    ) {
      unmatched++;
      continue;
    }
    if (+account.createdAt > +exposure.exposedAt + 7 * DAY) {
      lateSignups++;
      continue;
    }
    if (signups.has(exposure.id)) {
      duplicateSignups++;
      continue;
    }
    signups.set(exposure.id, account);
  }
  const rows = (["a", "b"] as const).map((variant) => {
    const cohort = exposures.filter((exposure) => exposure.variant === variant);
    const mature = (days: number) => cohort.filter((exposure) => +exposure.exposedAt + days * DAY <= +now);
    const signupCohort = mature(7),
      activationCohort = mature(14),
      paidCohort = mature(30);
    const within = (date: Date | null | undefined, start: Date, days: number) =>
      !!date && +date >= +start && +date <= +start + days * DAY && +date <= +now;
    const signups7d = signupCohort.filter((e) => signups.has(e.id)).length;
    return {
      variant,
      exposed: cohort.length,
      mature7d: signupCohort.length,
      signups7d,
      pending7d: cohort.length - signupCohort.length,
      observedSignups7d: cohort.filter((e) => signups.has(e.id)).length,
      mature14d: activationCohort.length,
      connected: activationCohort.filter((e) => {
        const a = signups.get(e.id);
        return a && within(a.experimentMilestone?.firstConnectedAt, a.createdAt, 7);
      }).length,
      activated: activationCohort.filter((e) => {
        const a = signups.get(e.id);
        return a && within(a.experimentMilestone?.firstPublishedAt, a.createdAt, 7);
      }).length,
      mature30d: paidCohort.length,
      paid: paidCohort.filter((e) => {
        const a = signups.get(e.id);
        return a && a.firstPayment && a.firstPayment.amountPaid > 0 && within(a.firstPayment.paidAt, e.exposedAt, 30);
      }).length,
    };
  });
  const total = rows[0].exposed + rows[1].exposed;
  // Pearson chi-square, one degree of freedom, p < 0.001. Diagnostic, not a treatment-effect test.
  const sampleRatioMismatch = total >= 20 && (rows[0].exposed - rows[1].exposed) ** 2 / total > 10.828;
  return { rows, unmatched, duplicateSignups, lateSignups, sampleRatioMismatch };
}

/** Wilson score interval, 95%; descriptive uncertainty, not an early-stopping rule. */
export function wilson(successes: number, total: number): [number, number] | null {
  if (!total) return null;
  const z = 1.959_963_984_540_054;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}
