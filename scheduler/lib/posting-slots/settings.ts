import { z } from "zod/v4";

import { prisma } from "@/lib/prisma";

// Reasonable upper bound so the settings table (and every slot expansion on
// the client) stays small.
export const MAX_POSTING_SLOTS = 24;

export const SLOT_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const postingSlotSchema = z.object({
  time: z.string().regex(SLOT_TIME_PATTERN, "Slot time must be in HH:mm format"),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
});

export const postingSlotsRequestSchema = z.object({
  slots: z.array(postingSlotSchema).max(MAX_POSTING_SLOTS),
});

export type PostingSlotInput = z.infer<typeof postingSlotSchema>;

export interface PostingSlot {
  time: string;
  weekdays: number[];
}

// Collapses duplicate times into one slot (union of weekdays), dedupes and
// sorts weekdays, and orders slots by time so the API always returns a
// canonical list regardless of how the client sent it.
export function normalizePostingSlots(slots: PostingSlotInput[]): PostingSlot[] {
  const byTime = new Map<string, Set<number>>();

  for (const slot of slots) {
    const weekdays = byTime.get(slot.time) ?? new Set<number>();
    for (const day of slot.weekdays) {
      weekdays.add(day);
    }
    byTime.set(slot.time, weekdays);
  }

  return [...byTime.entries()]
    .map(([time, weekdays]) => ({ time, weekdays: [...weekdays].sort((a, b) => a - b) }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

export async function getUserPostingSlots(userId: string): Promise<PostingSlot[]> {
  const slots = await prisma.postingSlot.findMany({
    where: { userId },
    select: { time: true, weekdays: true },
    orderBy: { time: "asc" },
  });

  return normalizePostingSlots(slots);
}

export async function updateUserPostingSlots(userId: string, slots: PostingSlotInput[]): Promise<PostingSlot[]> {
  const normalized = normalizePostingSlots(slots);

  await prisma.$transaction([
    prisma.postingSlot.deleteMany({ where: { userId } }),
    prisma.postingSlot.createMany({
      data: normalized.map((slot) => ({ userId, time: slot.time, weekdays: slot.weekdays })),
    }),
  ]);

  return normalized;
}
