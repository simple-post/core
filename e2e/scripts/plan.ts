import { selectedCases, catalog } from "../src/catalog.js";
import { selection } from "../src/config.js";
import { optionCoverage } from "../src/coverage-inventory.js";
import { postCost } from "../src/budget.js";
import { runnerArgs, runnerHelp } from "../src/runner-args.js";
try {
  const options = runnerArgs("plan", process.argv.slice(2));
  if (options.help) {
    console.log(runnerHelp("plan"));
    process.exit(0);
  }
  Object.assign(process.env, options.env);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
const s = selection();
const rows = selectedCases().flatMap((c) =>
  s.interfaces.map((iface) => ({
    scenario: c.id,
    platform: c.platform,
    interface: iface,
    supported: c.interfaces.includes(iface) && !c.unsupportedReason,
    mode: c.mode ?? "now",
    posts: postCost(c, iface),
    requires: (c.requirements ?? []).join(","),
    reason: c.unsupportedReason,
  })),
);
console.table(rows);
console.log(
  JSON.stringify(
    {
      catalogScenarios: catalog.length,
      selected: rows.length,
      unsupported: rows.filter((x) => !x.supported).length,
      maximumPosts: rows.filter((x) => x.supported).reduce((n, x) => n + x.posts, 0),
      optionGaps: optionCoverage().filter(
        (o) => ["gap", "unclassified"].includes(o.status) && s.platforms.some((p) => o.key.startsWith(p + ".")),
      ),
    },
    null,
    2,
  ),
);
console.log("Plan only. No accounts accessed and no posts created. Use narrower filters and budgets for live runs.");
