import type { ConnectedAccount } from "@/types";

import type { Prisma } from "@prisma/client";

export function isPreviewOnlyTokenMetadata(metadata: Prisma.JsonValue | null | undefined) {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).previewOnly === true
  );
}

export function isPreviewOnlyConnectedAccount(account: Pick<ConnectedAccount, "previewOnly" | "tokenMetadata">) {
  return account.previewOnly === true || isPreviewOnlyTokenMetadata(account.tokenMetadata);
}
