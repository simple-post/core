import type { AccountOptionsMap } from "@/types";

/** An edit must explicitly clear the manual publishing choice for this target. */
export function preserveThreadsHandoffOptions(
  accountIds: string[],
  previous: AccountOptionsMap | undefined,
  next: AccountOptionsMap | undefined,
): AccountOptionsMap | undefined {
  const retained = accountIds.filter(
    (id) => previous?.[id]?.finishInThreads === true && next?.[id]?.finishInThreads === undefined,
  );
  if (retained.length === 0) return next;
  return {
    ...next,
    ...Object.fromEntries(retained.map((id) => [id, { ...next?.[id], finishInThreads: true }])),
  };
}
