import { getInstagramCredentialRejection } from "@simple-post/sdk";

import { createLogger } from "@/lib/logger";
import {
  acquireConnectedAccountCredentialLock,
  CONNECTED_ACCOUNT_CREDENTIAL_TRANSACTION_OPTIONS,
} from "@/lib/oauth/connected-account-lock";
import { prisma } from "@/lib/prisma";
import { decryptTokenMetadata, encryptTokenMetadata } from "@/lib/security/connected-account-secrets";

import type { CredentialRejection } from "@simple-post/sdk";

const log = createLogger("connected-account-credentials");
type RejectionAccount = { id: string; platform: string; updatedAt: Date };
export type RecordCredentialRejectionResult = "recorded" | "already_blocked" | "stale" | "not_revoked";

/** One transition per credential generation. A newer reconnect/refresh always wins. */
export async function recordInstagramCredentialRejection(
  account: RejectionAccount,
  rejection: CredentialRejection,
): Promise<RecordCredentialRejectionResult> {
  if (
    account.platform !== "instagram" ||
    rejection.code !== 190 ||
    !["session_revoked", "authorization_removed"].includes(rejection.reason)
  )
    return "not_revoked";
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    await acquireConnectedAccountCredentialLock(tx, account.id);
    const stored = await tx.connectedAccount.findUnique({ where: { id: account.id } });
    if (!stored) return "stale" as const;
    if (stored.credentialRefreshBlockedAt) return "already_blocked" as const;
    if (stored.updatedAt.getTime() !== account.updatedAt.getTime()) return "stale" as const;
    const metadata = decryptTokenMetadata(stored.tokenMetadata);
    const updated = await tx.connectedAccount.updateMany({
      where: { id: account.id, updatedAt: account.updatedAt, credentialRefreshBlockedAt: null },
      data: {
        credentialRefreshBlockedAt: now,
        credentialRefreshRetryAt: null,
        updatedAt: now,
        tokenMetadata:
          encryptTokenMetadata({
            ...(metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}),
            credentialRejection: {
              reason: rejection.reason,
              code: rejection.code,
              ...(rejection.status !== undefined && { status: rejection.status }),
              ...(rejection.subcode !== undefined && { subcode: rejection.subcode }),
              ...(rejection.traceId && { traceId: rejection.traceId }),
              detectedAt: now.toISOString(),
            },
          }) ?? undefined,
      },
    });
    return updated.count === 1 ? ("recorded" as const) : ("stale" as const);
  }, CONNECTED_ACCOUNT_CREDENTIAL_TRANSACTION_OPTIONS);
  if (result === "recorded") {
    // Existing operator notification transport receives only the first transition, not every queued post.
    log.warn({ accountId: account.id, platform: account.platform, ...rejection }, "Account requires reconnection");
  }
  return result;
}

/** Only explicit revoked-session responses require reconnecting an otherwise unexpired token. */
export async function recordRevokedInstagramSession(account: RejectionAccount, details: unknown): Promise<void> {
  if (account.platform !== "instagram" || !details) return;
  const rejection = Array.isArray(details)
    ? details.find((issue) => issue?.platform === "instagram" && issue?.credentialRejection)?.credentialRejection
    : getInstagramCredentialRejection(details);
  if (rejection) await recordInstagramCredentialRejection(account, rejection);
}
