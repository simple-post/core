import { test, expect } from "@playwright/test";
import { summarizeCoverage } from "../src/coverage-summary.js";

test("coverage distinguishes triggering failures from later lane skips and unsupported cases", () => {
  const reason = "Platform lane paused after 3 failure(s): validation mismatch";
  const rows = [
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `instagram.validation-${index}`,
      interface: "mcp",
      status: "submitting",
      invocationStatus: "failed",
    })),
    ...Array.from({ length: 52 }, (_, index) => ({
      id: `instagram.case-${index}`,
      interface: index < 31 ? "mcp" : "cli-app",
      status: "blocked",
      invocationStatus: "skipped",
      blockedReason: reason,
    })),
    { id: "instagram.unsupported", interface: "ui", status: "unsupported", invocationStatus: "skipped" },
    { id: "telegram.smoke", interface: "ui", status: "verified", invocationStatus: "passed" },
  ];
  const result = summarizeCoverage(rows);
  expect(result).toMatchObject({
    total: 57,
    verified: 1,
    unsupported: 1,
    remaining: 55,
    failedThisInvocation: 3,
    lanePaused: 52,
  });
  expect(result.platforms[0]).toMatchObject({
    platform: "instagram",
    failedThisInvocation: 3,
    lanePaused: 52,
    pauses: [{ reason, count: 52, interfaces: { mcp: 31, "cli-app": 21 } }],
  });
});

test("a resumed report does not count a historical journal failure as a new failure", () => {
  const result = summarizeCoverage([
    { id: "threads.carousel", interface: "mcp", status: "inconclusive", invocationStatus: "not-run" },
  ]);
  expect(result).toMatchObject({ remaining: 1, failedThisInvocation: 0, lanePaused: 0 });
});
