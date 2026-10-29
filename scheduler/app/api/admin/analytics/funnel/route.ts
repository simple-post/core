import { type NextRequest, NextResponse } from "next/server";

import { hasAnalyticsAdminAccess } from "@/lib/analytics/admin";
import { buildCohortReport } from "@/lib/analytics/cohort-report";
import { cohortRange } from "@/lib/analytics/report";
import { DEMO_LOGIN_EMAIL } from "@/lib/auth/test-users";
import { env } from "@/lib/env";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { ApiError, handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";
/** Operator-only data endpoint. No new screens, labels, controls or customer flows. */
export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  if (env.SELF_HOSTED) return new NextResponse(null, { status: 404 });
  try {
    const session = await requireBrowserSession(req);
    if (!(await hasAnalyticsAdminAccess(session.user.id))) return new NextResponse(null, { status: 404 });
    const query = req.nextUrl.searchParams;
    const range = cohortRange(query.get("from") || undefined, query.get("to") || undefined);
    const windowDays = Number(query.get("window") ?? 7);
    const trialGraceDays = Number(query.get("grace") ?? 7);
    const attribution = query.get("attribution") ?? "first";
    if (
      ![1, 7, 14, 30].includes(windowDays) ||
      ![0, 7, 14].includes(trialGraceDays) ||
      !["first", "last_non_direct"].includes(attribution)
    )
      return NextResponse.json({ error: "Invalid cohort options" }, { status: 400, headers });
    const accounts = await prisma.user.findMany({
      where: {
        createdAt: { gte: range.start, lt: range.end },
        isAdmin: false,
        analyticsExcluded: false,
        email: { not: DEMO_LOGIN_EMAIL },
      },
      select: {
        createdAt: true,
        acquisition: true,
        lastNonDirectAcquisition: true,
        freeTrial: { select: { startsAt: true, expiresAt: true } },
        firstPayment: { select: { paidAt: true, attributionSnapshot: true } },
        subscription: { select: { status: true } },
        activationMilestone: true,
      },
      take: 10_001,
    });
    if (accounts.length > 10_000)
      return NextResponse.json({ error: "Choose a smaller signup cohort" }, { status: 400, headers });
    const report = buildCohortReport(accounts, {
      windowDays: windowDays as 1 | 7 | 14 | 30,
      trialGraceDays: trialGraceDays as 0 | 7 | 14,
      attribution: attribution as "first" | "last_non_direct",
    });
    const events = await prisma.funnelEvent.groupBy({
      by: ["kind", "channel"],
      where: {
        user: {
          is: {
            createdAt: { gte: range.start, lt: range.end },
            isAdmin: false,
            analyticsExcluded: false,
            email: { not: DEMO_LOGIN_EMAIL },
          },
        },
      },
      _count: { _all: true },
    });
    const breakdown = await prisma.$queryRaw<
      Array<{
        kind: string;
        channel: string;
        reason: string | null;
        platform: string | null;
        tool: string | null;
        client: string | null;
        plan: string | null;
        attempts: number;
      }>
    >`
      SELECT e.kind, e.channel, e.properties->>'reason' AS reason, e.properties->>'platform' AS platform,
        e.properties->>'tool' AS tool, e.properties->>'client' AS client, e.properties->>'plan' AS plan,
        count(*)::integer AS attempts
      FROM funnel_event e JOIN "user" u ON u.id=e."userId"
      WHERE u."createdAt">=${range.start.toISOString()}::timestamp AND u."createdAt"<${range.end.toISOString()}::timestamp
        AND NOT u."isAdmin" AND NOT u."analyticsExcluded" AND u.email<>${DEMO_LOGIN_EMAIL}
      GROUP BY e.kind,e.channel,e.properties->>'reason',e.properties->>'platform',e.properties->>'tool',e.properties->>'client',e.properties->>'plan'
      ORDER BY attempts DESC LIMIT 2001
    `;
    const anonymousAuthentication = await prisma.funnelEvent.groupBy({
      by: ["kind"],
      where: {
        userId: null,
        kind: { in: ["signup_code_sent", "signup_code_failed", "authentication_failed"] },
        occurredAt: { gte: range.start, lt: range.end },
      },
      _count: { _all: true },
    });
    return NextResponse.json(
      {
        ...report,
        range: { from: range.from, to: range.to },
        events,
        breakdown: breakdown.slice(0, 2000),
        breakdownTruncated: breakdown.length > 2000,
        anonymousAuthentication,
        eventsDefinition:
          "Lifetime observed event attempts for accounts in the selected signup cohort, since instrumentation rollout; not fixed-window unique users. Use rows for fixed-window conversion.",
        anonymousAuthenticationDefinition:
          "Server email-delivery and verification failure attempts by calendar date; not unique visitors or a joined signup denominator.",
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof ApiError) return handleApiError(error, req);
    return NextResponse.json(
      { error: "Unable to read analytics; sign in as a verified admin and check the date range." },
      { status: 400, headers },
    );
  }
}
