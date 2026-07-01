import { prisma } from "@/lib/prisma";
import type { AccountResultsMap, RepostStatus } from "@/types";

import { buildRepostTargetFromResult } from "./targets";

import type { RepostSettings } from "@simple-post/sdk";

export const DEFAULT_REPOST_SETTINGS: RepostSettings = {
  enabled: false,
  delayHours: 12,
};

// Upper bound on the repost delay, mirroring RepostSettingsSchema (30 days).
// Kept in sync here because this normalizer is a second entry point that not
// every caller routes through the Zod schema.
const MAX_DELAY_HOURS = 24 * 30;

export function normalizeRepostSettings(value: Partial<RepostSettings> | null | undefined): RepostSettings {
  const rawDelay = value?.delayHours;
  const delayHours =
    typeof rawDelay === "number" && Number.isFinite(rawDelay) && rawDelay > 0
      ? Math.min(Math.round(rawDelay), MAX_DELAY_HOURS)
      : DEFAULT_REPOST_SETTINGS.delayHours;

  return {
    enabled: value?.enabled ?? DEFAULT_REPOST_SETTINGS.enabled,
    delayHours,
  };
}

export async function getUserRepostSettings(userId: string): Promise<RepostSettings> {
  const settings = await prisma.userRepostSettings.findUnique({
    where: { userId },
    select: { enabled: true, delayHours: true },
  });

  return normalizeRepostSettings(settings);
}

export async function updateUserRepostSettings(
  userId: string,
  input: Partial<RepostSettings>,
): Promise<RepostSettings> {
  const settings = normalizeRepostSettings(input);
  const saved = await prisma.userRepostSettings.upsert({
    where: { userId },
    create: {
      userId,
      enabled: settings.enabled,
      delayHours: settings.delayHours,
    },
    update: {
      enabled: settings.enabled,
      delayHours: settings.delayHours,
    },
    select: {
      enabled: true,
      delayHours: true,
    },
  });

  return normalizeRepostSettings(saved);
}

export async function resolvePostRepostSettings(
  userId: string,
  override: Partial<RepostSettings> | undefined,
): Promise<RepostSettings> {
  if (override) {
    return normalizeRepostSettings(override);
  }

  return getUserRepostSettings(userId);
}

export function hasRepostTargets(accountResults: AccountResultsMap | null | undefined): boolean {
  return Object.values(accountResults ?? {}).some(
    (result) => buildRepostTargetFromResult(result.accountId, result.platform, result) !== null,
  );
}

export function buildPublishedRepostState(options: {
  enabled: boolean;
  delayHours: number;
  accountResults: AccountResultsMap | null | undefined;
  publishedAt: Date;
}): {
  repostDueAt: Date | null;
  repostStatus: RepostStatus;
} {
  if (!options.enabled || !hasRepostTargets(options.accountResults)) {
    return {
      repostDueAt: null,
      repostStatus: "not_applicable",
    };
  }

  return {
    repostDueAt: new Date(options.publishedAt.getTime() + options.delayHours * 60 * 60 * 1000),
    repostStatus: "scheduled",
  };
}
