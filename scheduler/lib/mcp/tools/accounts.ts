import { z } from "zod";

import { prisma } from "@/lib/prisma";

export const listAccountsSchema = z.object({});

export async function listAccounts(userId: string) {
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId },
    select: {
      id: true,
      platform: true,
      username: true,
      displayName: true,
      profilePicture: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return accounts;
}
