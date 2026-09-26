import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { hasAnalyticsAdminAccess } from "@/lib/analytics/admin";
import { cohortRange } from "@/lib/analytics/report";
import { auth } from "@/lib/auth/auth";
import { env } from "@/lib/env";
import { EXPERIMENT_IDS } from "@/lib/experiments/contract";
import { attribution, buildExperimentReport, wilson } from "@/lib/experiments/report";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const rate = (n: number, d: number) =>
  d ? `${n} / ${d} (${((100 * n) / d).toFixed(1)}%)` : "Awaiting mature exposures";
export default async function Experiments({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; experiment?: string }>;
}) {
  if (env.SELF_HOSTED) notFound();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return <LoginForm callbackURL="/admin/experiments" />;
  if (!(await hasAnalyticsAdminAccess(session.user.id))) notFound();
  const params = await searchParams;
  const experiment = params.experiment || EXPERIMENT_IDS[1];
  if (!(EXPERIMENT_IDS as readonly string[]).includes(experiment)) notFound();
  let range;
  try {
    range = cohortRange(params.from, params.to);
  } catch {
    return (
      <main className="p-8">
        Invalid dates. <a href="/admin/experiments">Reset report</a>
      </main>
    );
  }
  const now = new Date();
  const [exposures, accounts] = await Promise.all([
    prisma.experimentExposure.findMany({
      where: { experimentId: experiment, exposedAt: { gte: range.start, lt: range.end } },
      orderBy: { exposedAt: "asc" },
      take: 10_001,
    }),
    prisma.user.findMany({
      where: {
        experimentAttribution: { not: null },
        createdAt: { gte: range.start, lt: new Date(Math.min(+now + 1, +range.end + 7 * 86_400_000)) },
      },
      select: {
        createdAt: true,
        experimentAttribution: true,
        experimentMilestone: { select: { firstConnectedAt: true, firstPublishedAt: true } },
        firstPayment: { select: { paidAt: true, amountPaid: true } },
      },
      take: 10_001,
    }),
  ]);
  if (exposures.length > 10_000 || accounts.length > 10_000)
    return <main className="p-8">Choose a smaller date range (10,000 record limit).</main>;
  const report = buildExperimentReport(
    exposures,
    accounts.filter((a) => attribution(a.experimentAttribution)?.experimentId === experiment),
    now,
  );
  return (
    <main className="max-w-5xl mx-auto p-8 space-y-6">
      <a className="underline" href="/admin/analytics">
        Acquisition analytics
      </a>
      <h1 className="text-3xl font-semibold">Homepage experiment</h1>
      <p>
        Browser assignments with a recorded visible homepage exposure. New accounts only; one signup per assignment. All
        times UTC.
      </p>
      <form className="flex flex-wrap gap-4" method="get">
        <label>
          Experiment
          <select name="experiment" defaultValue={experiment} className="block border rounded p-2 bg-background">
            {EXPERIMENT_IDS.map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
        <label>
          Exposure from
          <input
            className="block border rounded p-2 bg-background"
            name="from"
            type="date"
            defaultValue={range.from}
            required
          />
        </label>
        <label>
          Through
          <input
            className="block border rounded p-2 bg-background"
            name="to"
            type="date"
            defaultValue={range.to}
            required
          />
        </label>
        <button className="border rounded px-4" type="submit">
          Update
        </button>
      </form>
      {report.sampleRatioMismatch && (
        <p role="alert" className="font-semibold">
          Assignment imbalance detected (p &lt; 0.001). Investigate tracking before interpreting conversion rates.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr>
              {[
                "Arm",
                "Exposures",
                "Signup ≤7d",
                "Connected ≤7d after signup",
                "Published ≤7d after signup",
                "Paid ≤30d",
              ].map((label) => (
                <th className="p-3 border-b" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.variant}>
                <th className="p-3 border-b">{row.variant.toUpperCase()}</th>
                <td className="p-3 border-b">{row.exposed}</td>
                <td className="p-3 border-b">{rate(row.signups7d, row.mature7d)}</td>
                <td className="p-3 border-b">{rate(row.connected, row.mature14d)}</td>
                <td className="p-3 border-b">{rate(row.activated, row.mature14d)}</td>
                <td className="p-3 border-b">{rate(row.paid, row.mature30d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        {report.rows
          .map((row) => {
            const interval = wilson(row.signups7d, row.mature7d);
            return `${row.variant.toUpperCase()} signup rate 95% Wilson interval: ${interval ? interval.map((value) => `${(100 * value).toFixed(1)}%`).join("–") : "awaiting mature data"}`;
          })
          .join(". ")}
        .
      </p>
      <p>
        Only fully mature exposure cohorts enter rates: 7 days for signup, 14 for connection/publication, 30 for
        payment. Connection, publication and payment also require signup within 7 days of exposure. Payments require a
        positive Stripe-confirmed first invoice.
      </p>
      <p>
        {report.rows
          .map(
            (r) =>
              `${r.variant.toUpperCase()}: ${r.pending7d} pending signup windows, ${r.observedSignups7d} observed in-window signups`,
          )
          .join(". ")}
        .
      </p>
      <p>
        Diagnostics among accounts created in this date range plus 7 days: {report.unmatched} missing, earlier or
        out-of-cohort exposures; {report.duplicateSignups} additional accounts on the same assignment;{" "}
        {report.lateSignups} late signups. These are excluded from rates.
      </p>
      <p>
        These are descriptive results, not a winner declaration. Predeclare the sample size and decision date; do not
        stop when one arm temporarily looks better. A/A renders identical copy in both arms. Cookie deletion, analytics
        blocking, shared browsers and cross-device signup limit attribution. Account deletion removes linked evidence.
        Plausible uses a different visitor definition and is not the denominator.
      </p>
    </main>
  );
}
