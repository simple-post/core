import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { hasAnalyticsAdminAccess } from "@/lib/analytics/admin";
import { acquisitionLabels, buildAcquisitionReport, cohortRange } from "@/lib/analytics/report";
import { auth } from "@/lib/auth/auth";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const cell = "px-4 py-3 text-left border-b border-border whitespace-nowrap";
const date = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString().slice(0, 10) : "—");

export default async function AcquisitionReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  if (env.SELF_HOSTED) notFound();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return <LoginForm callbackURL="/admin/analytics" />;
  if (!(await hasAnalyticsAdminAccess(session.user.id))) notFound();
  const params = await searchParams;
  let range;
  try {
    range = cohortRange(params.from, params.to);
  } catch (error) {
    return (
      <main className="max-w-5xl mx-auto p-8">
        <h1 className="text-2xl font-semibold">Acquisition analytics</h1>
        <p className="my-4">{error instanceof Error ? error.message : "Invalid dates."}</p>
        <a className="underline" href="/admin/analytics">
          Reset date range
        </a>
      </main>
    );
  }
  const accounts = await prisma.user.findMany({
    where: { createdAt: { gte: range.start, lt: range.end }, acquisition: { not: null } },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      acquisition: true,
      freeTrial: { select: { startsAt: true, expiresAt: true } },
      firstPayment: { select: { paidAt: true, planKey: true } },
      subscription: { select: { status: true, planKey: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10_001,
  });
  if (accounts.length > 10_000)
    return (
      <main className="max-w-5xl mx-auto p-8">
        <h1 className="text-2xl font-semibold">Choose a smaller signup cohort</h1>
        <p className="my-4">This report supports up to 10,000 accounts at a time.</p>
        <a className="underline" href={`?from=${range.to}&to=${range.to}`}>
          Choose a single day
        </a>
      </main>
    );
  const rows = buildAcquisitionReport(accounts);
  const payers = accounts
    .filter((account) => account.firstPayment)
    .sort((a, b) => b.firstPayment!.paidAt.getTime() - a.firstPayment!.paidAt.getTime());
  return (
    <main className="max-w-7xl mx-auto p-6 md:p-10 space-y-8">
      <header className="space-y-3">
        <a href="/schedule" className="text-sm underline text-muted-foreground">
          ← Back to SimplePost
        </a>
        <h1 className="text-3xl font-semibold">Acquisition analytics</h1>
        <p className="text-muted-foreground max-w-3xl">
          Follow each signup’s original source through the trial to their first payment. Payments are confirmed by
          Stripe, even if the customer never returns to the app.
        </p>
      </header>
      <form className="flex flex-wrap items-end gap-4" method="get">
        <label className="space-y-2">
          Signup from (UTC)
          <input
            className="block border border-border rounded-md bg-background px-3 py-2"
            type="date"
            name="from"
            defaultValue={range.from}
            required
          />
        </label>
        <label className="space-y-2">
          Signup through (UTC)
          <input
            className="block border border-border rounded-md bg-background px-3 py-2"
            type="date"
            name="to"
            defaultValue={range.to}
            required
          />
        </label>
        <button className="rounded-md bg-primary text-primary-foreground px-4 py-2" type="submit">
          Apply
        </button>
      </form>
      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ["Signups", accounts.length],
          ["Trials started", rows.reduce((sum, row) => sum + row.trials, 0)],
          ["Ever paid", payers.length],
        ].map(([label, value]) => (
          <div key={label} className="border border-border rounded-xl p-5">
            <p className="text-muted-foreground text-sm">{label}</p>
            <p className="text-3xl font-semibold mt-2">{value}</p>
          </div>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Sources and campaigns</h2>
        <p className="text-sm text-muted-foreground">
          The rate uses only trials whose full trial window has ended. It counts payments received through today,
          including later conversions. “Running, unpaid” trials are still in progress.
        </p>
        <div className="overflow-x-auto border border-border rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {[
                  "Source",
                  "Medium",
                  "Campaign",
                  "Signups",
                  "Trials",
                  "Ever paid",
                  "Running, unpaid",
                  "Mature trials",
                  "Mature, paid",
                  "Mature trial → paid",
                ].map((label) => (
                  <th className={cell} key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={JSON.stringify([row.source, row.medium, row.campaign])}>
                  {[
                    row.source,
                    row.medium,
                    row.campaign,
                    row.signups,
                    row.trials,
                    row.paid,
                    row.running,
                    row.matureTrials,
                    row.maturePaid,
                    row.matureConversionRate === null ? "—" : `${(row.matureConversionRate * 100).toFixed(1)}%`,
                  ].map((value, index) => (
                    <td className={cell} key={index}>
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="p-6 text-muted-foreground">
              No tracked signups in this date range. Attribution starts with accounts created after the tracking
              rollout.
            </p>
          )}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Customers who have paid</h2>
        <p className="text-sm text-muted-foreground">
          Latest 100 first payments in this signup cohort. Subscription status is shown separately: a customer who once
          paid may have since cancelled.
        </p>
        <div className="overflow-x-auto border border-border rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {[
                  "Customer",
                  "Email",
                  "Original source",
                  "Campaign",
                  "Landing page",
                  "First visit",
                  "Signup",
                  "Trial started",
                  "First paid",
                  "First plan",
                  "Current status",
                ].map((label) => (
                  <th className={cell} key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payers.slice(0, 100).map((account) => {
                const acquisition = acquisitionLabels(account.acquisition);
                return (
                  <tr key={account.id}>
                    {[
                      account.name,
                      account.email,
                      acquisition.source,
                      acquisition.campaign,
                      acquisition.landingPage,
                      date(acquisition.firstSeenAt),
                      date(account.createdAt),
                      date(account.freeTrial?.startsAt),
                      date(account.firstPayment?.paidAt),
                      account.firstPayment?.planKey || "—",
                      account.subscription?.status || "none",
                    ].map((value, index) => (
                      <td className={cell} key={index}>
                        {value}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {payers.length === 0 && (
            <p className="p-6 text-muted-foreground">No confirmed positive payments for this cohort yet.</p>
          )}
        </div>
      </section>
      <p className="text-sm text-muted-foreground">
        Source is first-touch browser attribution, not proof of causation. Missing or blocked attribution is “unknown”;
        older accounts are excluded rather than guessed. Counts are first payments, not MRR or net revenue, and refunds
        do not erase the historical conversion.
      </p>
    </main>
  );
}
