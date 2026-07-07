import { z } from "zod";

import { getConnectedAccountCredentialStatus } from "@/lib/oauth/credential-health";
import { prisma } from "@/lib/prisma";
import { decryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";

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
  credentialStatus: z
    .object({
      state: z.string(),
      severity: z.enum(["ok", "warning", "error"]),
      label: z.string(),
      message: z.string(),
      action: z.enum(["none", "refresh", "reconnect"]),
      expiresAt: z.string().nullable(),
      refreshTokenExpiresAt: z.string().nullable(),
    })
    .describe("Safe credential health summary. If action is reconnect, ask the user to reconnect before posting."),
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
    orderBy: { createdAt: "desc" },
  });

  const mappedAccounts = accounts.map((storedAccount) => {
    const account = decryptConnectedAccountSecrets(storedAccount);
    const credentialStatus = getConnectedAccountCredentialStatus(account);
    return {
      accountId: account.id,
      credentialStatus: {
        action: credentialStatus.action,
        expiresAt: credentialStatus.expiresAt,
        label: credentialStatus.label,
        message: credentialStatus.message,
        refreshTokenExpiresAt: credentialStatus.refreshTokenExpiresAt,
        severity: credentialStatus.severity,
        state: credentialStatus.state,
      },
      displayName: account.displayName,
      platform: account.platform,
      profilePicture: account.profilePicture,
      username: account.username,
    };
  });

  return {
    kind: "accounts" as const,
    accounts: mappedAccounts,
    summary: {
      total: mappedAccounts.length,
      platforms: [...new Set(mappedAccounts.map((account) => account.platform))],
    },
  };
}
