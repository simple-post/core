import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--out")) {
  throw new Error("Usage: yarn muse:personal:prepare [--out NEW_DIRECTORY]");
}
const output = resolve(root, args[1] || "dist/personal-muse-connector");
// Refuse to replace an existing directory or reviewer evidence.
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
execFileSync(
  "yarn",
  ["workspace", "@simple-post/scheduler", "test", "--runInBand", "tests/lib/mcp/personal-muse.test.ts"],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, SIMPLEPOST_MUSE_EXPORT_DIR: output },
  },
);
for (const file of ["connector.json", "tool-review.json", "README.md", "REVIEW.md", "DATA_PROCESSING.md"]) {
  await copyFile(join(root, "integrations/personal-muse", file), join(output, file));
}
await copyFile(join(root, "scheduler/public/simplepost-sidebar-sp-v1.svg"), join(output, "simplepost-logo.svg"));
const profiles = JSON.parse(await readFile(join(output, "tool-contracts.json"), "utf8"));
const tools = profiles.find((profile) => profile.profile === "extensions-and-fitting").tools;
await writeFile(
  join(output, "TOOL_REVIEW.md"),
  [
    "# Personal Muse tool review",
    "",
    "Generated from the current core registrations. Internal review material, not a Meta manifest.",
    "",
    "| Tool | Muse class | Approval | Side effects |",
    "| --- | --- | --- | --- |",
    ...tools.map(
      (tool) =>
        `| ${tool.name} | ${tool.museReview.class} | ${tool.museReview.approval} | ${tool.museReview.effect.replaceAll("|", "\\|")} |`,
    ),
    "",
    "Inputs, output schemas, canonical MCP annotations and permission requirements are in tool-contracts.json. A null outputSchema means the live tool has no advertised JSON output schema; use its documented structured/text result and REVIEW.md scenarios.",
    "",
  ].join("\n"),
  { flag: "wx" },
);
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const dirty =
  execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root, encoding: "utf8" }).trim()
    .length > 0;
await writeFile(
  join(output, "build-info.json"),
  `${JSON.stringify({ revision, dirty, generatedAt: new Date().toISOString(), liveMuseTested: false, submitted: false }, null, 2)}\n`,
  { flag: "wx" },
);
console.log(
  `Personal Muse review bundle: ${output}\nNo account data, credentials, model API calls, live tool execution or submission performed.`,
);
