import { test } from "@playwright/test";
import { selectedCases } from "../src/catalog.js";
import { loadConfig } from "../src/config.js";
import { runScenario } from "../src/run.js";
import type { Interface } from "../src/types.js";
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
    await runScenario(loadConfig(), scenario, iface, page, browser, info);
  });
}
