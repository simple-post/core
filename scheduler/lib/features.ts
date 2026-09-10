import { Feature } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/utils/errors";

export async function hasFeature(userId: string, feature: Feature): Promise<boolean> {
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
  return grants.map(({ feature }) => feature);
}

export async function requireImageFitting(userId: string): Promise<void> {
  if (!(await hasFeature(userId, Feature.IMAGE_FITTING))) {
    throw new ForbiddenError("Image fitting is not enabled for this account.");
  }
}
