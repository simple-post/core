export interface CoverageRow {
  id: string;
  interface: string;
  status: string;
  invocationStatus: string;
  blockedReason?: string;
}

export function summarizeCoverage(rows: CoverageRow[]) {
  const count = (group: CoverageRow[]) => ({
    total: group.length,
    verified: group.filter((row) => row.status === "verified").length,
    unsupported: group.filter((row) => row.status === "unsupported").length,
    remaining: group.filter((row) => !["verified", "unsupported"].includes(row.status)).length,
    failedThisInvocation: group.filter((row) => ["failed", "timedOut", "interrupted"].includes(row.invocationStatus))
      .length,
    lanePaused: group.filter((row) => row.blockedReason?.startsWith("Platform lane paused")).length,
  });
  const platforms = [...new Set(rows.map((row) => row.id.split(".")[0]))].map((platform) => {
    const group = rows.filter((row) => row.id.startsWith(platform + "."));
    const pauses = new Map<string, { reason: string; count: number; interfaces: Record<string, number> }>();
    for (const row of group.filter((row) => row.blockedReason?.startsWith("Platform lane paused"))) {
      const reason = row.blockedReason!;
      const pause = pauses.get(reason) ?? { reason, count: 0, interfaces: {} };
      pause.count++;
      pause.interfaces[row.interface] = (pause.interfaces[row.interface] ?? 0) + 1;
      pauses.set(reason, pause);
    }
    return { platform, ...count(group), pauses: [...pauses.values()] };
  });
  return { ...count(rows), platforms };
}
