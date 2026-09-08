import {
  acquireConnectedAccountCredentialLock,
  CONNECTED_ACCOUNT_CREDENTIAL_TRANSACTION_OPTIONS,
} from "@/lib/oauth/connected-account-lock";
import { prisma } from "@/lib/prisma";

/** Only explicit revoked-session responses require reconnecting an otherwise unexpired token. */
export async function recordRevokedInstagramSession(
  account: { id: string; platform: string; updatedAt: Date },
  details: unknown,
): Promise<void> {
  if (account.platform !== "instagram" || !details) return;
  let text: string;
  try {
    text = JSON.stringify(details);
  } catch {
    return;
  }
  if (!/session has been invalidated/i.test(text)) return;
  await prisma.$transaction(async (tx) => {
    await acquireConnectedAccountCredentialLock(tx, account.id);
    // A reconnect or refresh after this publishing attempt must win.
    await tx.connectedAccount.updateMany({
      where: { id: account.id, updatedAt: account.updatedAt },
      data: { credentialRefreshBlockedAt: new Date(), credentialRefreshRetryAt: null },
    });
  }, CONNECTED_ACCOUNT_CREDENTIAL_TRANSACTION_OPTIONS);
}
