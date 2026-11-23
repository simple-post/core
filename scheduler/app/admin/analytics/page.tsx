import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { UiCopy } from "@/components/ui-copy";
import { hasAnalyticsAdminAccess } from "@/lib/analytics/admin";
import { buildLandingReport, type LandingRow } from "@/lib/analytics/landing-report";
import { openAiAdsConfigured, OPENAI_ADS_KINDS } from "@/lib/analytics/openai-ads";
import { acquisitionLabels, buildAcquisitionReport, cohortRange } from "@/lib/analytics/report";
import { auth } from "@/lib/auth/auth";
import { DEMO_LOGIN_EMAIL } from "@/lib/auth/test-users";
import { getPlanByKey } from "@/lib/billing/plans";
import { env } from "@/lib/env";
import { planName, subscriptionStatusLabel } from "@/lib/i18n/billing-display";
import { getUiCopy } from "@/lib/i18n/request-copy";
import type { SourceCopy } from "@/lib/i18n/source-copy";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const cell = "px-4 py-3 text-start border-b border-border whitespace-nowrap";
const date = (value: Date | string | null | undefined, locale: string) =>
  value
    ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(
        new Date(value),
      )
    : "—";

export default async function AcquisitionReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { copy, locale } = await getUiCopy();
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
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
        <h1 className="text-2xl font-semibold">{copy("Acquisition analytics")}</h1>
        <p className="my-4">
          {error instanceof Error && error.message === "Choose a signup cohort of 1–366 days."
            ? copy("Choose a signup cohort of 1–366 days.")
            : copy("Choose valid signup dates.")}
        </p>
        <a className="underline" href="/admin/analytics">
          {copy("Reset date range")}{" "}
        </a>
      </main>
    );
  }
  const accounts = await prisma.user.findMany({
    where: {
      createdAt: { gte: range.start, lt: range.end },
      acquisition: { not: null },
      isAdmin: false,
      analyticsExcluded: false,
      email: { not: DEMO_LOGIN_EMAIL },
    },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      acquisition: true,
      freeTrial: { select: { startsAt: true, expiresAt: true } },
      firstPayment: { select: { paidAt: true, planKey: true } },
      subscription: { select: { status: true, planKey: true } },
      openAiAdsMeasurement: {
        select: { permissionRevokedAt: true, reportedKinds: true, skippedKinds: true, lastError: true },
      },
      activationMilestone: {
        select: {
          socialConnectedAt: true,
          aiConnectedAt: true,
          firstPostCreatedAt: true,
          firstPostScheduledAt: true,
          firstPostPublishedAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10_001,
  });
  if (accounts.length > 10_000)
    return (
      <main className="max-w-5xl mx-auto p-8">
        <h1 className="text-2xl font-semibold">{copy("Choose a smaller signup cohort")}</h1>
        <p className="my-4">{copy("This report supports up to 10,000 accounts at a time.")}</p>
        <a className="underline" href={`?from=${range.to}&to=${range.to}`}>
          {copy("Choose a single day")}{" "}
        </a>
      </main>
    );
  const rows = buildAcquisitionReport(accounts);
  const landing = buildLandingReport(accounts);
  const payers = accounts
    .filter((account) => account.firstPayment)
    .sort((a, b) => b.firstPayment!.paidAt.getTime() - a.firstPayment!.paidAt.getTime());
  return (
    <main className="max-w-7xl mx-auto p-6 md:p-10 space-y-8">
      <header className="space-y-3">
        <a href="/schedule" className="text-sm underline text-muted-foreground">
          {copy("Back to SimplePost")}{" "}
        </a>
        <h1 className="text-3xl font-semibold">{copy("Acquisition analytics")}</h1>
        <a href="/admin/experiments" className="underline">
          {copy("Homepage experiments")}{" "}
        </a>
        <p className="text-muted-foreground max-w-3xl">
          {copy(
            "Follow each signup’s original source through the trial to their first payment. Payments are confirmed by Stripe, even if the customer never returns to the app.",
          )}{" "}
        </p>
      </header>
      <section className="space-y-3 rounded-xl border border-border p-5">
        <h2 className="text-xl font-semibold">{copy("OpenAI ad measurement")}</h2>
        <p>
          {openAiAdsConfigured()
            ? copy("Server configuration: enabled.")
            : copy("Server configuration: incomplete or disabled.")}
        </p>
        <p className="text-sm text-muted-foreground">
          {copy(
            "Delivery counts below use this signup cohort. Accepted events are not necessarily attributed ad conversions; Ads Manager matches eligible clicks and views separately. Your source reports below retain each account’s original first touch.",
          )}{" "}
        </p>
        <p>
          {copy(
            "Accounts with permission: {{permission, number}}. Accounts with delivery errors: {{errors, number}}.",
            {
              permission: accounts.filter((a) => a.openAiAdsMeasurement && !a.openAiAdsMeasurement.permissionRevokedAt)
                .length,
              errors: accounts.filter((a) => a.openAiAdsMeasurement?.lastError).length,
            },
          )}
        </p>
        <ul className="text-sm space-y-1">
          {OPENAI_ADS_KINDS.map((kind) => (
            <li key={kind}>
              {copy(
                "{{kind}}: {{accepted, number}} accepted; {{skipped, number}} skipped (outside permission or delivery window, or invalid).",
                {
                  kind,
                  accepted: accounts.filter((a) => a.openAiAdsMeasurement?.reportedKinds.includes(kind)).length,
                  skipped: accounts.filter((a) => a.openAiAdsMeasurement?.skippedKinds.includes(kind)).length,
                },
              )}
            </li>
          ))}
        </ul>
      </section>
      <form className="flex flex-wrap items-end gap-4" method="get">
        <label className="space-y-2">
          <UiCopy
            source="Signup from (UTC) <part1></part1>"
            components={{
              part1: (
                <input
                  className="block border border-border rounded-md bg-background px-3 py-2"
                  type="date"
                  name="from"
                  defaultValue={range.from}
                  required
                />
              ),
            }}
          />
        </label>
        <label className="space-y-2">
          <UiCopy
            source="Signup through (UTC) <part1></part1>"
            components={{
              part1: (
                <input
                  className="block border border-border rounded-md bg-background px-3 py-2"
                  type="date"
                  name="to"
                  defaultValue={range.to}
                  required
                />
              ),
            }}
          />
        </label>
        <button className="rounded-md bg-primary text-primary-foreground px-4 py-2" type="submit">
          {copy("Apply")}{" "}
        </button>
      </form>
      <section className="grid gap-4 sm:grid-cols-3">
        {[
          [copy("Signups"), accounts.length],
          [copy("Trials started"), rows.reduce((sum, row) => sum + row.trials, 0)],
          [copy("Ever paid"), payers.length],
        ].map(([label, value]) => (
          <div key={label} className="border border-border rounded-xl p-5">
            <p className="text-muted-foreground text-sm">{label}</p>
            <p className="text-3xl font-semibold mt-2">{typeof value === "number" ? number.format(value) : value}</p>
          </div>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{copy("Sources and campaigns")}</h2>
        <p className="text-sm text-muted-foreground">
          {copy(
            "The rate uses only trials whose full trial window has ended. It counts payments received through today, including later conversions. “Running, unpaid” trials are still in progress.",
          )}{" "}
        </p>
        <div className="overflow-x-auto border border-border rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {[
                  copy("Source"),
                  copy("Medium"),
                  copy("Campaign"),
                  copy("Ad / content"),
                  copy("Signups"),
                  copy("Trials"),
                  copy("Ever paid"),
                  copy("Running, unpaid"),
                  copy("Mature trials"),
                  copy("Mature, paid"),
                  copy("Mature trial → paid"),
                ].map((label) => (
                  <th className={cell} key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={JSON.stringify([row.source, row.medium, row.campaign, row.content])}>
                  {[
                    row.source,
                    row.medium,
                    row.campaign,
                    row.content,
                    row.signups,
                    row.trials,
                    row.paid,
                    row.running,
                    row.matureTrials,
                    row.maturePaid,
                    row.matureConversionRate === null ? "—" : percent.format(row.matureConversionRate),
                  ].map((value, index) => (
                    <td className={cell} key={index}>
                      {typeof value === "number" ? number.format(value) : value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="p-6 text-muted-foreground">
              {copy(
                "No tracked signups in this date range. Attribution starts with accounts created after the tracking rollout.",
              )}{" "}
            </p>
          )}
        </div>
      </section>
      <LandingTable
        title={copy("Landing categories → activation")}
        description={copy(
          "Signups by the category of their first landing page (platform, AI client, guide, tool, comparison, MCP, pricing, about), and how many reached each first-time milestone. Milestones are recorded for every interface, including MCP and scheduled dispatch; percentages are of signups.",
        )}
        firstColumn={copy("Category")}
        rows={landing.categories}
        categories
      />
      <LandingTable
        title={copy("SEO landing pages → activation")}
        description={copy(
          "Top 50 SEO landing pages in this cohort. Use this with Search Console to decide which topics deserve more pages.",
        )}
        firstColumn={copy("Landing page")}
        rows={landing.pages}
      />
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{copy("Customers who have paid")}</h2>
        <p className="text-sm text-muted-foreground">
          {copy(
            "Latest 100 first payments in this signup cohort. Subscription status is shown separately: a customer who once paid may have since cancelled.",
          )}{" "}
        </p>
        <div className="overflow-x-auto border border-border rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {[
                  copy("Customer"),
                  copy("Email"),
                  copy("Original source"),
                  copy("Campaign"),
                  copy("Ad / content"),
                  copy("Landing page"),
                  copy("First visit"),
                  copy("Signup"),
                  copy("Trial started"),
                  copy("First paid"),
                  copy("First plan"),
                  copy("Current status"),
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
                      acquisition.content,
                      acquisition.landingPage,
                      date(acquisition.firstSeenAt, locale),
                      date(account.createdAt, locale),
                      date(account.freeTrial?.startsAt, locale),
                      date(account.firstPayment?.paidAt, locale),
                      planName(
                        getPlanByKey(account.firstPayment?.planKey)?.name ?? account.firstPayment?.planKey ?? "—",
                        copy,
                      ),
                      subscriptionStatusLabel(account.subscription?.status || "none", copy),
                    ].map((value, index) => (
                      <td className={cell} key={index}>
                        {typeof value === "number" ? number.format(value) : value}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {payers.length === 0 && (
            <p className="p-6 text-muted-foreground">{copy("No confirmed positive payments for this cohort yet.")}</p>
          )}
        </div>
      </section>
      <p className="text-sm text-muted-foreground">
        {copy(
          "Source is first-touch browser attribution, not proof of causation. Missing or blocked attribution is “unknown”; older accounts are excluded rather than guessed. Counts are first payments, not MRR or net revenue, and refunds do not erase the historical conversion.",
        )}{" "}
      </p>
    </main>
  );
}

async function LandingTable({
  title,
  description,
  firstColumn,
  rows,
  categories = false,
}: {
  title: string;
  description: string;
  firstColumn: string;
  rows: LandingRow[];
  categories?: boolean;
}) {
  const { copy, locale } = await getUiCopy();
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground max-w-3xl">{description}</p>
      <div className="overflow-x-auto border border-border rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {[
                firstColumn,
                copy("Signups"),
                copy("Social account"),
                copy("AI integration"),
                copy("First post"),
                copy("First scheduled"),
                copy("First published"),
                copy("Paid"),
              ].map((label) => (
                <th className={cell} key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className={cell}>{categories ? categoryLabel(row.key, copy) : row.key}</td>
                <td className={cell}>{number.format(row.signups)}</td>
                {[
                  row.socialConnected,
                  row.aiConnected,
                  row.postCreated,
                  row.postScheduled,
                  row.postPublished,
                  row.paid,
                ].map((value, index) => (
                  <td className={cell} key={index}>
                    {typeof value === "number" ? number.format(value) : value}{" "}
                    <span className="text-muted-foreground">
                      ({row.signups ? percent.format(value / row.signups) : "—"})
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="p-6 text-muted-foreground">{copy("No tracked signups in this date range.")}</p>
        )}
      </div>
    </section>
  );
}

function categoryLabel(category: string, copy: SourceCopy): string {
  switch (category) {
    case "platform": {
      return copy("Platform");
    }
    case "ai_client": {
      return copy("AI client");
    }
    case "guide": {
      return copy("Guide");
    }
    case "tool": {
      return copy("Tool");
    }
    case "comparison": {
      return copy("Comparison");
    }
    case "mcp": {
      return copy("MCP");
    }
    case "pricing": {
      return copy("Pricing");
    }
    case "about": {
      return copy("About");
    }
    case "home": {
      return copy("Home");
    }
    case "app": {
      return copy("App");
    }
    case "other": {
      return copy("Other");
    }
    case "unknown": {
      return copy("Unknown");
    }
    default: {
      return category;
    }
  }
}
