import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { UiCopy } from "@/components/ui-copy";
import { hasAnalyticsAdminAccess } from "@/lib/analytics/admin";
import { cohortRange } from "@/lib/analytics/report";
import { auth } from "@/lib/auth/auth";
import { env } from "@/lib/env";
import { EXPERIMENT_IDS } from "@/lib/experiments/contract";
import { attribution, buildExperimentReport, wilson } from "@/lib/experiments/report";
import { getUiCopy } from "@/lib/i18n/request-copy";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export default async function Experiments({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; experiment?: string }>;
}) {
  const { copy, locale } = await getUiCopy();
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const rate = (n: number, d: number) =>
    d
      ? copy("{{numerator, number}} / {{denominator, number}} ({{percentage}})", {
          numerator: n,
          denominator: d,
          percentage: percent.format(n / d),
        })
      : copy("Awaiting mature exposures");
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
        {copy("Invalid dates.")} <a href="/admin/experiments">{copy("Reset report")}</a>
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
        activationMilestone: { select: { socialConnectedAt: true, firstPostPublishedAt: true } },
        firstPayment: { select: { paidAt: true, amountPaid: true } },
      },
      take: 10_001,
    }),
  ]);
  if (exposures.length > 10_000 || accounts.length > 10_000)
    return <main className="p-8">{copy("Choose a smaller date range (10,000 record limit).")}</main>;
  const report = buildExperimentReport(
    exposures,
    accounts.filter((a) => attribution(a.experimentAttribution)?.experimentId === experiment),
    now,
  );
  return (
    <main className="max-w-5xl mx-auto p-8 space-y-6">
      <a className="underline" href="/admin/analytics">
        {copy("Acquisition analytics")}{" "}
      </a>
      <h1 className="text-3xl font-semibold">{copy("Homepage experiment")}</h1>
      <p>
        {copy(
          "Browser assignments with a recorded visible homepage exposure. New accounts only; one signup per assignment. All times UTC.",
        )}{" "}
      </p>
      <form className="flex flex-wrap gap-4" method="get">
        <label>
          {copy("Experiment")}{" "}
          <select name="experiment" defaultValue={experiment} className="block border rounded p-2 bg-background">
            {EXPERIMENT_IDS.map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
        <label>
          <UiCopy
            source="Exposure from <part1></part1>"
            components={{
              part1: (
                <input
                  className="block border rounded p-2 bg-background"
                  name="from"
                  type="date"
                  defaultValue={range.from}
                  required
                />
              ),
            }}
          />
        </label>
        <label>
          <UiCopy
            source="Through <part1></part1>"
            components={{
              part1: (
                <input
                  className="block border rounded p-2 bg-background"
                  name="to"
                  type="date"
                  defaultValue={range.to}
                  required
                />
              ),
            }}
          />
        </label>
        <button className="border rounded px-4" type="submit">
          {copy("Update")}{" "}
        </button>
      </form>
      {report.sampleRatioMismatch && (
        <p role="alert" className="font-semibold">
          {copy(
            "Assignment imbalance detected (p < 0.001). Investigate tracking before interpreting conversion rates.",
          )}{" "}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-start">
          <thead>
            <tr>
              {[
                copy("Arm"),
                copy("Exposures"),
                copy("Signup ≤7d"),
                copy("Connected ≤7d after signup"),
                copy("Published ≤7d after signup"),
                copy("Paid ≤30d"),
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
                <td className="p-3 border-b">{number.format(row.exposed)}</td>
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
            return interval
              ? copy("{{variant}} signup rate 95% Wilson interval: {{lower}}–{{upper}}", {
                  variant: row.variant.toUpperCase(),
                  lower: percent.format(interval[0]),
                  upper: percent.format(interval[1]),
                })
              : copy("{{variant}} signup rate 95% Wilson interval: awaiting mature data", {
                  variant: row.variant.toUpperCase(),
                });
          })
          .join(". ")}
        .
      </p>
      <p>
        {copy(
          "Only fully mature exposure cohorts enter rates: 7 days for signup, 14 for connection/publication, 30 for payment. Connection, publication and payment also require signup within 7 days of exposure. Payments require a positive Stripe-confirmed first invoice.",
        )}{" "}
      </p>
      <p>
        {report.rows
          .map((r) =>
            copy(
              "{{variant}}: {{pending, number}} pending signup windows, {{signups, number}} observed in-window signups",
              { variant: r.variant.toUpperCase(), pending: r.pending7d, signups: r.observedSignups7d },
            ),
          )
          .join(". ")}
        .
      </p>
      <p>
        {copy(
          "Diagnostics among accounts created in this date range plus 7 days: {{unmatched, number}} missing, earlier or out-of-cohort exposures; {{duplicates, number}} additional accounts on the same assignment; {{late, number}} late signups. These are excluded from rates.",
          { unmatched: report.unmatched, duplicates: report.duplicateSignups, late: report.lateSignups },
        )}
      </p>
      <p>
        {copy(
          "These are descriptive results, not a winner declaration. Predeclare the sample size and decision date; do not stop when one arm temporarily looks better. A/A renders identical copy in both arms. Cookie deletion, analytics blocking, shared browsers and cross-device signup limit attribution. Account deletion removes linked evidence. Plausible uses a different visitor definition and is not the denominator.",
        )}{" "}
      </p>
    </main>
  );
}
