import { test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { selectedCases } from "../src/catalog.js";
import { loadConfig, runId, selection } from "../src/config.js";
import { runScenario } from "../src/run.js";
import type { Interface } from "../src/types.js";
import { blockedAnnotation, RunControl } from "../src/execution.js";

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

for (const iface of selection().interfaces)
  test.describe(iface, () => {
    for (const scenario of selectedCases()) {
      const postingTest = scenario.unsupportedReason || !scenario.interfaces.includes(iface) ? test.skip : test;
      postingTest(
        `${scenario.id} @${scenario.platform} ${scenario.tags.map((t) => "@" + t).join(" ")}`,
        { annotation: { type: "interface", description: iface } },
        async ({ page, browser }, info) => {
          test.skip(Boolean(scenario.unsupportedReason), scenario.unsupportedReason ?? "Unsupported scenario");
          test.skip(
            !scenario.interfaces.includes(iface),
            `Unsupported interface for this scenario; included in coverage.json`,
          );
          const blocked = preflightBlockReason(scenario.id, iface);
          if (blocked) blockedAnnotation(info, blocked);
          test.skip(Boolean(blocked), blocked);
          const config = loadConfig();
          const control = new RunControl(config, runId());
          const reason = await control.blocked(scenario.platform);
          if (reason) blockedAnnotation(info, reason);
          test.skip(Boolean(reason), reason);
          try {
            await runScenario(config, scenario, iface, page, browser, info);
            await control.success(scenario.platform);
          } catch (error) {
            await control.failure(scenario.platform, error);
            throw error;
          }
        },
      );
    }
  });
