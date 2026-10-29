import { type NextRequest, NextResponse } from "next/server";

import { hasAnalyticsAdminAccess } from "@/lib/analytics/admin";
import { buildCohortReport, COHORT_GROUPS, type CohortGroup } from "@/lib/analytics/cohort-report";
import { cohortRange } from "@/lib/analytics/report";
import { DEMO_LOGIN_EMAIL } from "@/lib/auth/test-users";
import { env } from "@/lib/env";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/utils/errors";
export const dynamic = "force-dynamic";
/** Operator-only aggregates; no new screens or customer flow. */
export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  if (env.SELF_HOSTED) return new NextResponse(null, { status: 404 });
  try {
    const session = await requireBrowserSession(req);
    if (!(await hasAnalyticsAdminAccess(session.user.id))) return new NextResponse(null, { status: 404 });
    const query = req.nextUrl.searchParams;
    let range: ReturnType<typeof cohortRange>;
    try {
      range = cohortRange(query.get("from") || undefined, query.get("to") || undefined);
    } catch {
      return NextResponse.json({ error: "Invalid signup date range" }, { status: 400, headers });
    }
    const windowDays = Number(query.get("window") ?? 7),
      trialGraceDays = Number(query.get("grace") ?? 7),
      attribution = query.get("attribution") ?? "first",
      groupBy = query.get("groupBy") ?? "source";
    if (
      ![1, 7, 14, 30].includes(windowDays) ||
      ![0, 7, 14].includes(trialGraceDays) ||
      !["first", "last_non_direct"].includes(attribution) ||
      !COHORT_GROUPS.includes(groupBy as CohortGroup)
    )
      return NextResponse.json({ error: "Invalid cohort options" }, { status: 400, headers });
    const where = {
      createdAt: { gte: range.start, lt: range.end },
      isAdmin: false,
      analyticsExcluded: false,
      email: { not: DEMO_LOGIN_EMAIL },
    };
    const accounts = await prisma.user.findMany({
      where,
      select: {
        createdAt: true,
        acquisition: true,
        freeTrial: { select: { startsAt: true, expiresAt: true } },
        firstPayment: { select: { paidAt: true } },
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
      groupBy: groupBy as CohortGroup,
    });
    const breakdown = await prisma.$queryRaw<
      Array<{
        kind: string;
        channel: string;
        outcome: string | null;
        reason: string | null;
        platform: string | null;
        tool: string | null;
        plan: string | null;
        attempts: number;
      }>
    >`
   SELECT e.kind,e.channel,e.properties->>'outcome' AS outcome,e.properties->>'reason' AS reason,e.properties->>'platform' AS platform,e.properties->>'tool' AS tool,e.properties->>'plan' AS plan,count(*)::integer AS attempts
   FROM funnel_event e JOIN "user" u ON u.id=e."userId"
   WHERE u."createdAt">=${range.start.toISOString()}::timestamp AND u."createdAt"<${range.end.toISOString()}::timestamp AND NOT u."isAdmin" AND NOT u."analyticsExcluded" AND u.email<>${DEMO_LOGIN_EMAIL}
   GROUP BY e.kind,e.channel,e.properties->>'outcome',e.properties->>'reason',e.properties->>'platform',e.properties->>'tool',e.properties->>'plan'
   ORDER BY attempts DESC LIMIT 2001
  `;
    return NextResponse.json(
      {
        ...report,
        range: { from: range.from, to: range.to },
        breakdown: breakdown.slice(0, 2000),
        breakdownTruncated: breakdown.length > 2000,
        breakdownDefinition:
          "Lifetime observed attempts for accounts in this signup cohort since rollout; not fixed-window unique users. One tool_call per completed invocation with its outcome. Use totals/rows for cohort conversion.",
      },
      { headers },
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}
