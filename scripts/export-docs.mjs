import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const core = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(core, "scheduler/package.json"));
const { build } = require("esbuild");
const check = process.argv.includes("--check");
const outIndex = process.argv.indexOf("--out");
const destination = path.resolve(outIndex < 0 ? path.join(core, "../docs/static") : process.argv[outIndex + 1]);
const cacheRoot = path.join(core, "scheduler/node_modules/.cache");
await mkdir(cacheRoot, { recursive: true });
const temp = await mkdtemp(path.join(cacheRoot, "docs-export-"));
const entry = `
import { createSchedulerOpenApiDocument } from './scheduler/lib/openapi/document';
import { createServerOpenApiDocument } from './server/src/openapi/document';
import { BILLING_PLANS, TRIAL_DURATION_DAYS, TRIAL_POSTS_PER_PLATFORM, TRIAL_MAX_THREAD_SEGMENTS } from './scheduler/lib/billing/plans';
import { ALL_SOCIAL_PLATFORMS } from './scheduler/lib/config';
import { getValidationRulesForPlatform } from './sdk/src/validation';
export const scheduler = createSchedulerOpenApiDocument();
export const server = createServerOpenApiDocument();
export const facts = {
  plans: BILLING_PLANS.map(({key,name,prices,limits}) => ({key,name,prices,limits})),
  trial: { days: TRIAL_DURATION_DAYS, postsPerPlatform: TRIAL_POSTS_PER_PLATFORM, maxThreadSegments: TRIAL_MAX_THREAD_SEGMENTS },
  platforms: ALL_SOCIAL_PLATFORMS.map(({id,name}) => ({ id, name, rules: getValidationRulesForPlatform(id) }))
};`;
try {
  const compiled = path.join(temp, "export.cjs");
  const result = await build({
    stdin: { contents: entry, resolveDir: core, loader: "ts" },
    outfile: compiled,
    absWorkingDir: core,
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    metafile: true,
    tsconfig: path.join(core, "scheduler/tsconfig.json"),
    alias: {
      "@simple-post/sdk": path.join(core, "sdk/src/index.ts"),
      "@simple-post/sdk/platform-names": path.join(core, "sdk/src/platform-names.ts"),
      "@simple-post/sdk/validation": path.join(core, "sdk/src/validation.ts"),
      "@simple-post/sdk/media-types": path.join(core, "sdk/src/media-types.ts"),
    },
    define: {
      "process.env.NEXT_PUBLIC_APP_URL": JSON.stringify("https://app.simplepost.social"),
      "process.env.SIMPLE_POST_PUBLIC_URL": JSON.stringify("http://localhost:3000"),
    },
  });
  const { scheduler, server, facts } = require(compiled);
  const mcpSource = await readFile(path.join(core, "scheduler/lib/mcp/server.ts"), "utf8");
  facts.mcpTools = [...mcpSource.matchAll(/registerAppTool\(\s*server,\s*"([a-z_]+)"/g)].map((match) => match[1]);
  if (facts.mcpTools.length === 0)
    throw new Error("No MCP tools found; update the exporter for the current registration API.");
  const files = Object.keys(result.metafile.inputs)
    .filter((file) => !file.includes("node_modules") && file !== "<stdin>")
    .sort();
  const hash = createHash("sha256");
  for (const file of files) hash.update(await readFile(path.resolve(core, file)));
  hash.update(mcpSource);
  const snapshots = { "openapi/scheduler.json": scheduler, "openapi/server.json": server, "product-facts.json": facts };
  let stale = false;
  for (const [name, value] of Object.entries(snapshots)) {
    const file = path.join(destination, name);
    const output = JSON.stringify(value, null, 2) + "\n";
    if (check) {
      const current = await readFile(file, "utf8").catch(() => "");
      if (current !== output) {
        console.error(`Outdated snapshot: ${name}`);
        stale = true;
      }
    } else {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, output);
    }
  }
  if (!check) {
    await writeFile(
      path.join(destination, "docs-source.json"),
      JSON.stringify(
        {
          repository: "https://github.com/simple-post/core",
          revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: core, encoding: "utf8" }).trim(),
          sourceHash: hash.digest("hex"),
          note: "Generated from this checkout. Source hash covers bundled source inputs and MCP registrations; revision identifies the checkout base.",
        },
        null,
        2,
      ) + "\n",
    );
  }
  if (stale) process.exitCode = 1;
  else
    console.log(
      check ? "Documentation snapshots match core." : `Exported API references and product facts to ${destination}`,
    );
} finally {
  await rm(temp, { recursive: true, force: true });
}
