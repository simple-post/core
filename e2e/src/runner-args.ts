import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { platforms, interfaces } from "./types.js";

export type RunnerMode = "live" | "plan";
export function runnerArgs(mode: RunnerMode, args: string[], inherited: NodeJS.ProcessEnv = process.env) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      platform: { type: "string", multiple: true },
      interface: { type: "string", multiple: true },
      profile: { type: "string" },
      all: { type: "boolean" },
      scenario: { type: "string" },
      config: { type: "string" },
      help: { type: "boolean", short: "h" },
      ...(mode === "live"
        ? {
            "run-id": { type: "string" as const },
            "verify-only": { type: "boolean" as const },
            headed: { type: "boolean" as const },
            list: { type: "boolean" as const },
          }
        : {}),
    },
  });
  const env = { ...inherited };
  if (values.help) return { env, help: true, playwrightArgs: [] as string[] };
  const csv = (name: string, value: string[], allowed: readonly string[]) => {
    const entries = value.flatMap((v) => v.split(",").map((s) => s.trim()));
    if (entries.some((v) => !allowed.includes(v)))
      throw new Error(`Invalid --${name}; choose from ${allowed.join(", ")}`);
    return [...new Set(entries)].join(",");
  };
  if (values.platform) env.E2E_PLATFORMS = csv("platform", values.platform, platforms);
  if (values.interface) env.E2E_INTERFACES = csv("interface", values.interface, interfaces);
  if (values.all && values.profile && values.profile !== "full")
    throw new Error("--all cannot be combined with a different --profile");
  if (values.profile !== undefined) {
    if (!["smoke", "full", "regression", "lifecycle", "negative"].includes(values.profile))
      throw new Error("Invalid --profile; choose smoke, full, regression, lifecycle, or negative");
    env.E2E_PROFILE = values.profile;
  }
  if (values.all) env.E2E_PROFILE = "full";
  for (const [flag, key] of [
    ["scenario", "E2E_SCENARIO"],
    ["config", "E2E_CONFIG"],
    ["run-id", "E2E_RUN_ID"],
  ] as const) {
    const value = values[flag];
    if (value !== undefined) {
      if (typeof value !== "string" || !value.trim()) throw new Error(`--${flag} cannot be empty`);
      env[key] = value;
    }
  }
  if (mode === "live") {
    if (values["verify-only"]) env.E2E_VERIFY_ONLY = "1";
    if (env.E2E_VERIFY_ONLY === "1" && !env.E2E_RUN_ID && !values.list)
      throw new Error("--verify-only requires --run-id from an existing run");
    env.E2E_LIVE = values.list || env.E2E_VERIFY_ONLY === "1" ? "0" : "1";
    if (!env.E2E_RUN_ID)
      env.E2E_RUN_ID = `live-${new Date().toISOString().replace(/[^0-9]/g, "")}-${randomUUID().slice(0, 8)}`;
    if (!/^[a-zA-Z0-9_-]{1,70}$/.test(env.E2E_RUN_ID))
      throw new Error("--run-id must contain 1–70 letters, digits, underscores, or hyphens");
  }
  return {
    env,
    help: false,
    playwrightArgs: [...(values.headed ? ["--headed"] : []), ...(values.list ? ["--list"] : [])],
  };
}

export function runnerHelp(mode: RunnerMode) {
  return `Usage: yarn e2e:${mode} [options]

  --platform NAME     Select a platform (repeat or comma-separate names)
  --interface NAME    Select mcp, cli-app, cli-local, or ui (repeatable)
  --all               Select the full scenario catalog (default: smoke)
  --profile NAME      smoke, full, regression, lifecycle, or negative
  --scenario TEXT     Filter scenario IDs by substring; prefix with = for an exact ID
  --config FILE       Use a different test-account configuration
  --help, -h          Show this help
${
  mode === "live"
    ? `
  --run-id ID         Resume an existing run; otherwise a unique ID is generated
  --verify-only       Verify existing receipts without posting; requires --run-id
  --headed            Show the browser
  --list              List tests without accessing accounts or publishing

The live command enables real posting. Existing budgets and stop-on-failure rules apply.
`
    : "\nPlan only: no account access, uploads, or publishing.\n"
}
Command-line options override matching E2E_* environment variables.
Platform/interface defaults come from your saved setup.
`;
}
