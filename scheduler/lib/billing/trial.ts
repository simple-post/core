import { Prisma } from "@prisma/client";

import { TRIAL_DURATION_DAYS } from "@/lib/billing/plans";
import { countAccountsByPlatform } from "@/lib/config";
import { env } from "@/lib/env";
import { billingLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import type { FreeTrial, PrismaClient } from "@prisma/client";

type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

type TrialClient = PrismaClient | PrismaTransactionClient;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Posts in these states have not consumed anything, so they stay free during the trial. */
const UNCHARGED_POST_STATUSES = ["draft"];

export function calculateTrialEnd(start: Date, durationDays: number = TRIAL_DURATION_DAYS): Date {
  return new Date(start.getTime() + durationDays * MILLISECONDS_PER_DAY);
}

export function isTrialActive(trial: FreeTrial | null, now: Date = new Date()): boolean {
  if (!trial) return false;
  return trial.startsAt.getTime() <= now.getTime() && trial.expiresAt.getTime() > now.getTime();
}

/** Whole days left, rounded up, so the last partial day still reads as "1 day left". */
export function getTrialDaysRemaining(trial: FreeTrial, now: Date = new Date()): number {
  const remainingMs = trial.expiresAt.getTime() - now.getTime();
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / MILLISECONDS_PER_DAY);
}

/**
 * Give a user their one and only free trial.
 *
 * Safe to call on every request: an existing row (active *or* expired) is left
 * untouched, which is exactly what stops a returning user from restarting the
 * trial.
 *
 * The trial is for genuinely new users. Any prior access grant disqualifies —
 * a Stripe subscription record in *any* state, or a complimentary grant even
 * after it has expired. Otherwise a churned customer would land a free week
 * every time their subscription lapsed.
 */
export async function ensureTrialStarted(userId: string, now: Date = new Date()): Promise<FreeTrial | null> {
  if (env.SELF_HOSTED) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      freeTrial: true,
      subscription: { select: { id: true } },
      complimentaryAccess: { select: { id: true } },
    },
  });

  if (!user) return null;
  if (user.freeTrial) return user.freeTrial;
  if (user.subscription || user.complimentaryAccess) return null;

  try {
    const trial = await prisma.freeTrial.create({
      data: { userId, startsAt: now, expiresAt: calculateTrialEnd(now) },
    });
    billingLogger.info({ userId, expiresAt: trial.expiresAt.toISOString() }, "Free trial started");
    return trial;
  } catch (error) {
    // Concurrent requests from the same session can race on the unique userId;
    // the loser just reads the winner's row.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.freeTrial.findUnique({ where: { userId } });
    }
    throw error;
  }
}

/**
 * Publishes charged against each platform's trial allowance.
 *
 * The unit is one publish to one account, so a post targeting two X accounts
 * costs two X slots — that matches what actually goes out to the platform.
 * Drafts are excluded: the trial only charges once a post is scheduled or
 * published.
 */
export async function getTrialPlatformUsage(
  userId: string,
  trial: FreeTrial,
  client: TrialClient = prisma,
): Promise<Record<string, number>> {
  const posts = await client.post.findMany({
    where: {
      userId,
      createdAt: { gte: trial.startsAt },
      status: { notIn: UNCHARGED_POST_STATUSES },
    },
    select: { accounts: { select: { platform: true } } },
  });

  return countAccountsByPlatform(posts.flatMap((post) => post.accounts));
}
