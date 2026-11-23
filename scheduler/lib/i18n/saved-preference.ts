import { prisma } from "@/lib/prisma";

import { normalizeLocale } from "./locales";

/** A dedicated UI preference, never inferred from post language or publishing settings. */
export async function savedUiLocale(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { uiLocale: true } });
  return normalizeLocale(user?.uiLocale);
}
