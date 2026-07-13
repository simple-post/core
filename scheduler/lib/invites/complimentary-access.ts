import { ACTIVE_SUBSCRIPTION_STATUSES, getPlanByKey } from "@/lib/billing/plans";
import { prisma } from "@/lib/prisma";
import { BadRequestError, ConflictError, GoneError, NotFoundError } from "@/lib/utils/errors";

import type { Prisma } from "@prisma/client";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function calculateComplimentaryAccessEnd(start: Date, durationDays: number): Date {
  return new Date(start.getTime() + durationDays * MILLISECONDS_PER_DAY);
}

function hasActivePaidSubscription(
  subscription: { status: string; currentPeriodEnd: Date | null } | null,
  now: Date,
): boolean {
  if (!subscription || !ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) return false;
  return !subscription.currentPeriodEnd || subscription.currentPeriodEnd.getTime() >= now.getTime();
}

export interface RedeemedComplimentaryInvite {
  planKey: string;
  startsAt: Date;
  expiresAt: Date;
  alreadyRedeemed: boolean;
}

/**
 * Redeem a single-use invite and create its user grant in one transaction.
 * updateMany is the atomic claim: only one concurrent request can change an
 * invite whose redeemedAt value is still null.
 */
export async function redeemComplimentaryInvite(
  userId: string,
  code: string,
  now: Date = new Date(),
): Promise<RedeemedComplimentaryInvite> {
  const normalizedCode = code.trim();
  if (!normalizedCode || normalizedCode.length > 200) {
    throw new BadRequestError("Enter a valid invitation code");
  }

  const redeem = () =>
    prisma.$transaction(
      async (tx) => {
        const invite = await tx.complimentaryAccessInvite.findUnique({
          where: { code: normalizedCode },
        });

        if (!invite) {
          throw new NotFoundError("This complimentary access invitation is not valid");
        }

        if (invite.redeemedAt) {
          if (invite.redeemedByUserId !== userId) {
            throw new ConflictError("This complimentary access invitation has already been used");
          }

          const existingAccess = await tx.complimentaryAccess.findUnique({ where: { userId } });
          if (!existingAccess || existingAccess.inviteId !== invite.id) {
            throw new ConflictError("This invitation has already been redeemed");
          }

          return {
            planKey: existingAccess.planKey,
            startsAt: existingAccess.startsAt,
            expiresAt: existingAccess.expiresAt,
            alreadyRedeemed: true,
          };
        }

        if (invite.expiresAt && invite.expiresAt.getTime() <= now.getTime()) {
          throw new GoneError("This complimentary access invitation has expired");
        }
        if (!getPlanByKey(invite.planKey)) {
          throw new BadRequestError("This invitation is configured with an unknown plan");
        }
        if (!Number.isInteger(invite.accessDurationDays) || invite.accessDurationDays <= 0) {
          throw new BadRequestError("This invitation has an invalid access duration");
        }

        const user = await tx.user.findUnique({
          where: { id: userId },
          select: {
            subscription: { select: { status: true, currentPeriodEnd: true } },
            complimentaryAccess: { select: { expiresAt: true } },
          },
        });
        if (!user) {
          throw new NotFoundError("User not found");
        }
        if (hasActivePaidSubscription(user.subscription, now)) {
          throw new ConflictError("Your account already has an active paid subscription");
        }
        if (user.complimentaryAccess && user.complimentaryAccess.expiresAt.getTime() > now.getTime()) {
          throw new ConflictError("Your account already has active complimentary access");
        }

        const claim = await tx.complimentaryAccessInvite.updateMany({
          where: { id: invite.id, redeemedAt: null },
          data: { redeemedAt: now, redeemedByUserId: userId },
        });
        if (claim.count !== 1) {
          throw new ConflictError("This complimentary access invitation has already been used");
        }

        const expiresAt = calculateComplimentaryAccessEnd(now, invite.accessDurationDays);
        const access = await tx.complimentaryAccess.upsert({
          where: { userId },
          create: {
            userId,
            planKey: invite.planKey,
            startsAt: now,
            expiresAt,
            source: "invite",
            inviteId: invite.id,
          },
          update: {
            planKey: invite.planKey,
            startsAt: now,
            expiresAt,
            source: "invite",
            inviteId: invite.id,
          },
        });

        return {
          planKey: access.planKey,
          startsAt: access.startsAt,
          expiresAt: access.expiresAt,
          alreadyRedeemed: false,
        };
      },
      { isolationLevel: "Serializable" as Prisma.TransactionIsolationLevel },
    );

  // Serializable transactions can abort one side of a concurrent redemption.
  // Retry once so the loser observes the committed claim and gets a stable,
  // idempotent result (same user) or a clear already-used response.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await redeem();
    } catch (error) {
      const isSerializationConflict =
        typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
      if (!isSerializationConflict || attempt === 1) {
        throw error;
      }
    }
  }

  throw new ConflictError("This complimentary access invitation could not be redeemed");
}
