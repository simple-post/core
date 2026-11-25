import type { SecretStore } from "../secrets.js";
import type { RefreshedAnalyticsCredentials } from "@simple-post/sdk";

/** Keeps rotated tokens returned by the SDK so the next command does not reuse a consumed refresh token. */
export async function persistRefreshedSecrets(
  store: SecretStore,
  secretRef: string,
  refreshed: RefreshedAnalyticsCredentials | undefined,
): Promise<void> {
  if (!refreshed) return;
  const existing = await store.read(secretRef);
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return;
  await store.write(secretRef, {
    ...existing,
    ...(refreshed.accessToken ? { accessToken: refreshed.accessToken } : {}),
    ...(refreshed.refreshToken ? { refreshToken: refreshed.refreshToken } : {}),
    ...(typeof refreshed.expiresAt === "number" ? { expiresAt: refreshed.expiresAt } : {}),
  });
}
