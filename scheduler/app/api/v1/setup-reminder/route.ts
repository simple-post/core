import { type NextRequest, NextResponse } from "next/server";

import { Prisma } from "@prisma/client";

import { isTestUserEmail } from "@/lib/auth/test-users";
import { env } from "@/lib/env";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { hasAllowedOrigin } from "@/lib/middleware/origin";
import { setupReminderDueAt, setupReminderKey } from "@/lib/onboarding/setup-reminder";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

const privateResponse = { headers: { "Cache-Control": "private, no-store" } };

function canRequestReminder(user: { email: string; emailVerified: boolean; createdAt: Date }, now: Date) {
  return (
    !env.SELF_HOSTED && user.emailVerified && !isTestUserEmail(user.email) && setupReminderDueAt(user.createdAt) > now
  );
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireBrowserSession(req);
    const notice = await prisma.billingNotification.findUnique({
      where: { key: setupReminderKey(user.id) },
      select: { status: true },
    });
    return NextResponse.json(
      { available: !notice && canRequestReminder(user, new Date()), pending: notice?.status === "pending" },
      privateResponse,
    );
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!hasAllowedOrigin(req)) throw new ForbiddenError();
    const { user } = await requireBrowserSession(req);
    const now = new Date();
    if (!canRequestReminder(user, now)) throw new ForbiddenError();
    const account = await prisma.connectedAccount.findFirst({ where: { userId: user.id }, select: { id: true } });
    if (account) throw new ForbiddenError();

    const effectiveAt = setupReminderDueAt(user.createdAt);
    const key = setupReminderKey(user.id);
    await prisma.billingNotification.createMany({
      data: {
        key,
        userId: user.id,
        kind: "setup_reminder",
        consentRecipient: user.email,
        occurredAt: now,
        effectiveAt,
        nextAttemptAt: effectiveAt,
      },
      skipDuplicates: true,
    });
    const notice = await prisma.billingNotification.findUnique({ where: { key }, select: { status: true } });
    return NextResponse.json({ available: false, pending: notice?.status === "pending" }, privateResponse);
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!hasAllowedOrigin(req)) throw new ForbiddenError();
    const { user } = await requireBrowserSession(req);
    await prisma.billingNotification.updateMany({
      where: { key: setupReminderKey(user.id), status: "pending" },
      data: {
        status: "cancelled",
        consentWithdrawnAt: new Date(),
        leaseUntil: null,
        leaseToken: null,
        message: Prisma.DbNull,
        lastError: "withdrawn_by_user",
      },
    });
    return NextResponse.json({ available: false, pending: false }, privateResponse);
  } catch (error) {
    return handleApiError(error, req);
  }
}
