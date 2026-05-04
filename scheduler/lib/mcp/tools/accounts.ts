import { z } from "zod";

import { prisma } from "@/lib/prisma";

export const listAccountsSchema = z.object({});

export const mcpAccountSchema = z.object({
  accountId: z.string().describe("SimplePost connected account ID to pass to posting tools."),
  platform: z.string().describe("Social platform key, such as x, instagram, facebook, or linkedin."),
  username: z.string().nullable().describe("Platform username or handle when available."),
  displayName: z.string().nullable().describe("Human-readable account or page name when available."),
  profilePicture: z
    .string()
    .nullable()
    .optional()
    .describe("Public URL for the account's profile picture, when available."),
});

export const listAccountsOutputSchema = z.object({
  kind: z.literal("accounts"),
  accounts: z.array(mcpAccountSchema),
  summary: z.object({
    total: z.number(),
    platforms: z.array(z.string()),
  }),
});

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

  const mappedAccounts = accounts.map((account) => ({
    accountId: account.id,
    platform: account.platform,
    username: account.username,
    displayName: account.displayName,
    profilePicture: account.profilePicture,
  }));

  return {
    kind: "accounts" as const,
    accounts: mappedAccounts,
    summary: {
      total: mappedAccounts.length,
      platforms: [...new Set(mappedAccounts.map((account) => account.platform))],
    },
  };
}
