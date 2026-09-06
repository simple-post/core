import type { Scenario, Interface, JournalEntry } from "./types.js";

export function postCost(s: Scenario): number {
  if (s.mode === "cancel" || s.mode === "draft") return 0;
  // Telegram returns only the first ID, but an album creates one message per attachment.
  // Invalid cases retain a conservative cost in case a validation regression publishes them.
  return (s.platform === "telegram" ? Math.max(1, s.media.length) : 1) + (s.thread?.length ?? 0);
}

/** Retain previous reservations when resuming with a changed selection; never count them twice. */
export function budgetPlan(
  cases: readonly Scenario[],
  interfaces: readonly Interface[],
  entries: readonly JournalEntry[],
) {
  const reserved = new Map(entries.map((e) => [e.key, postCost(e.scenario)]));
  const spent = [...reserved.values()].reduce((n, cost) => n + cost, 0);
  let remaining = 0;
  for (const s of cases)
    for (const iface of new Set(interfaces)) {
      const key = `${iface}/${s.id}`;
      if (!s.interfaces.includes(iface) || reserved.has(key)) continue;
      const cost = postCost(s);
      reserved.set(key, cost);
      remaining += cost;
    }
  return { spent, remaining, total: spent + remaining };
}
