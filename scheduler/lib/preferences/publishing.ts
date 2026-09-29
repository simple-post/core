import { z } from "zod";

import { prisma } from "@/lib/prisma";

export const timeZoneSchema = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid IANA timezone, such as Europe/Berlin.");
export const publishingSettingsSchema = z
  .object({
    timeZone: timeZoneSchema.optional(),
    calendarView: z.enum(["day", "week", "month"]).optional(),
    defaultAccountIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .strict();

export async function readPublishingPreferences(userId: string) {
  const saved = await prisma.userPublishingPreferences.findUnique({ where: { userId } });
  return {
    timeZone: saved?.timeZone ?? "UTC",
    timeZoneConfirmed: !!saved?.timeZone,
    calendarView: (saved?.calendarView ?? "week") as "day" | "week" | "month",
    defaultAccountIds: saved?.defaultAccountIds ?? [],
  };
}

export async function updatePublishingPreferences(userId: string, input: z.infer<typeof publishingSettingsSchema>) {
  const set = publishingSettingsSchema.parse(input);
  if (set.defaultAccountIds) {
    set.defaultAccountIds = [...new Set(set.defaultAccountIds)];
    const count = await prisma.connectedAccount.count({ where: { userId, id: { in: set.defaultAccountIds } } });
    if (count !== set.defaultAccountIds.length) throw new Error("One or more destinations are no longer connected.");
  }
  await prisma.userPublishingPreferences.upsert({ where: { userId }, create: { userId, ...set }, update: set });
  return readPublishingPreferences(userId);
}
