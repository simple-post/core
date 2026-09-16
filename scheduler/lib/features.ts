import { Feature } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/utils/errors";

/**
 * Features switched on for everyone, as a comma-separated list of `Feature`
 * enum names (e.g. `GLOBAL_FEATURES=IMAGE_FITTING`). This is the rollout lever
 * once a private feature is ready for all users: it needs no migration and no
 * per-user grants, and unsetting it reverts to grants alone. Unrecognized names
 * are ignored so a typo cannot switch something unintended on.
 */
function globallyEnabledFeatures(): Set<Feature> {
  const configured = process.env.GLOBAL_FEATURES;
  if (!configured) return new Set();

  const known = new Set<string>(Object.values(Feature));
  return new Set(
    configured
      .split(",")
      .map((name) => name.trim().toUpperCase())
      .filter((name): name is Feature => known.has(name)),
  );
}

export async function hasFeature(userId: string, feature: Feature): Promise<boolean> {
  if (globallyEnabledFeatures().has(feature)) return true;

  const grant = await prisma.userFeature.findUnique({
    where: { userId_feature: { userId, feature } },
    select: { userId: true },
  });
  return grant !== null;
}

export async function getUserFeatures(userId: string): Promise<Feature[]> {
  const grants = await prisma.userFeature.findMany({
    where: { userId },
    select: { feature: true },
  });
  // The UI reads this to decide which controls to show, so it has to agree with
  // hasFeature — otherwise a globally enabled feature works but stays hidden.
  return [...new Set([...globallyEnabledFeatures(), ...grants.map(({ feature }) => feature)])];
}

export async function requireImageFitting(userId: string): Promise<void> {
  if (!(await hasFeature(userId, Feature.IMAGE_FITTING))) {
    throw new ForbiddenError("Image fitting is not enabled for this account.");
  }
}
