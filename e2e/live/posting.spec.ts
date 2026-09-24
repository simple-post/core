import { test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { selectedCases } from "../src/catalog.js";
import { loadConfig, runId } from "../src/config.js";
import { runScenario } from "../src/run.js";
import type { Interface } from "../src/types.js";

function preflightBlockReason(scenarioId: string, iface: Interface): string | undefined {
  const config = loadConfig();
  const coverageFile = path.join(config.runDir, runId(), "coverage.json");
  if (!existsSync(coverageFile)) return undefined;
  const matrix = JSON.parse(readFileSync(coverageFile, "utf8")) as Array<{
    id: string;
    interface: string;
    status: string;
    reason?: string;
  }>;
  const row = matrix.find((item) => item.id === scenarioId && item.interface === iface);
  return row?.status === "blocked" ? (row.reason ?? "Blocked by live preflight") : undefined;
}

for (const scenario of selectedCases()) {
  test(`${scenario.id} @${scenario.platform} ${scenario.tags.map((t) => "@" + t).join(" ")}`, async ({
    page,
    browser,
  }, info) => {
    const iface = info.project.name as Interface;
    test.skip(Boolean(scenario.unsupportedReason), scenario.unsupportedReason ?? "Unsupported scenario");
    test.skip(
      !scenario.interfaces.includes(iface),
      `Unsupported interface for this scenario; included in coverage.json`,
    );
    const blocked = preflightBlockReason(scenario.id, iface);
    test.skip(Boolean(blocked), blocked);
    await runScenario(loadConfig(), scenario, iface, page, browser, info);
  });
}
