import { test, expect } from "@playwright/test";
import { reportRows, reportHtml, reportCsv } from "../src/aggregate-report.js";
import type { AggregateAttempt } from "../src/aggregate.js";
import type { Scenario } from "../src/types.js";
import { account, config } from "./helpers.js";

const scenario: Scenario = {
  id: "x.video",
  platform: "x",
  media: ["video"],
  options: {},
  tags: ["full"],
  interfaces: ["mcp", "cli-app"],
};
const cfg = config({ accounts: { x: account() } });
function attempt(overrides: Partial<AggregateAttempt> = {}): AggregateAttempt {
  return {
    run: "run-one",
    key: "mcp/x.video",
    accountId: "account-1",
    platform: "x",
    interface: "mcp",
    scenarioId: scenario.id,
    scenarioSignature: "signature",
    currentDefinition: true,
    phase: "verified",
    updatedAt: "2026-09-06T12:00:00.000Z",
    ...overrides,
  };
}
test("matrix includes unrun and unsupported cells, and never borrows retired or other-account passes", () => {
  const rows = reportRows(cfg, [attempt({ currentDefinition: false }), attempt({ accountId: "another" })], [scenario]);
  expect(rows.map((r) => [r.interface, r.status, r.verified])).toEqual([
    ["ui", "Unsupported", false],
    ["mcp", "Not run", false],
    ["cli-app", "Not run", false],
  ]);
  const excluded = reportRows(config({ accounts: {} }), [attempt()], [scenario]);
  expect(excluded.every((r) => r.status === "Excluded" && !r.eligible && !r.verified)).toBe(true);
  const paused = reportRows(cfg, [attempt()], [{ ...scenario, unsupportedReason: "Paused" }]);
  expect(paused.every((r) => r.status === "Unsupported" && !r.verified)).toBe(true);
});
test("a later failure retains the earlier verified receipt without claiming the latest attempt passed", () => {
  const rows = reportRows(
    cfg,
    [attempt(), attempt({ run: "run-two", phase: "inconclusive", updatedAt: "2026-09-06T13:00:00.000Z" })],
    [scenario],
  );
  const row = rows.find((r) => r.interface === "mcp")!;
  expect(row.status).toBe("Passed previously");
  expect(row.latest?.run).toBe("run-two");
  expect(row.passed?.run).toBe("run-one");
  expect(row.history).toHaveLength(2);
});
test("browser filters work and untrusted provider text remains text in HTML and CSV", async ({ page }) => {
  const error = '=HYPERLINK("https://example.com") <img src=x onerror="window.injected=true">';
  const rows = reportRows(cfg, [attempt({ phase: "inconclusive", error })], [scenario]);
  await page.setContent(reportHtml(rows, "2026-09-06", () => true));
  expect(await page.evaluate(() => (window as unknown as { injected?: boolean }).injected)).toBeUndefined();
  await expect(page.locator("#cases tbody tr:visible")).toHaveCount(2);
  await page.getByLabel("Interface", { exact: true }).selectOption("mcp");
  await expect(page.locator("#cases tbody tr:visible")).toHaveCount(1);
  await expect(page.locator("#cases tbody tr:visible .reason")).toHaveText(error);
  await page.getByLabel("Search cases").fill("not-present");
  await expect(page.locator("#cases tbody tr:visible")).toHaveCount(0);
  await page.getByLabel("Search cases").fill("");
  await page.getByLabel("Interface", { exact: true }).selectOption("");
  await page.getByLabel("Include unsupported / excluded").check();
  await expect(page.locator("#cases tbody tr:visible")).toHaveCount(3);
  await page.getByText("Attempts and receipts (1)", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Run report" })).toHaveAttribute("href", "run-one/html/index.html");
  expect(reportCsv(rows)).toContain("\"'=HYPERLINK");
});
