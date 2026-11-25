import { canForceRefresh, freshnessWindowMs, isStale, nextRefreshAt } from "@/lib/post-analytics/freshness";

const HOUR = 3_600_000;
const now = new Date("2026-11-21T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("analytics freshness", () => {
  it("refreshes young posts often and old posts rarely", () => {
    expect(freshnessWindowMs(ago(HOUR), now)).toBe(15 * 60_000);
    expect(freshnessWindowMs(ago(3 * 24 * HOUR), now)).toBe(HOUR);
    expect(freshnessWindowMs(ago(20 * 24 * HOUR), now)).toBe(6 * HOUR);
    expect(freshnessWindowMs(ago(60 * 24 * HOUR), now)).toBe(24 * HOUR);
    expect(freshnessWindowMs(ago(400 * 24 * HOUR), now)).toBe(7 * 24 * HOUR);
  });

  it("backs off after failures", () => {
    const publishedAt = ago(HOUR);
    const delay = (status: Parameters<typeof nextRefreshAt>[0]["status"], failureCount: number) =>
      nextRefreshAt({ publishedAt, status, failureCount, now }).getTime() - now.getTime();
    expect(delay("rate_limited", 1)).toBe(30 * 60_000);
    expect(delay("rate_limited", 10)).toBe(6 * HOUR);
    expect(delay("missing_permission", 1)).toBe(24 * HOUR);
    expect(delay("not_found", 1)).toBe(7 * 24 * HOUR);
  });

  it("retries permission errors right after the account is reconnected", () => {
    const row = { nextRefreshAt: new Date(now.getTime() + HOUR), fetchedAt: ago(HOUR), status: "missing_permission" };
    expect(isStale(row, { updatedAt: ago(2 * HOUR) }, now)).toBe(false);
    expect(isStale(row, { updatedAt: ago(60_000) }, now)).toBe(true);
    expect(isStale({ ...row, status: "ok" }, { updatedAt: ago(60_000) }, now)).toBe(false);
  });

  it("limits forced refreshes to once per two minutes", () => {
    expect(canForceRefresh({ fetchedAt: ago(60_000) }, now)).toBe(false);
    expect(canForceRefresh({ fetchedAt: ago(3 * 60_000) }, now)).toBe(true);
    expect(canForceRefresh({ fetchedAt: null }, now)).toBe(true);
  });
});
