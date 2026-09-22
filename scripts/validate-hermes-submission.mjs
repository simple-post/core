import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(scriptDir, "..");
const kit = join(repo, "integrations", "hermes-agent");
const skill = join(
  kit,
  "skill",
  "optional-skills",
  "social-media",
  "simplepost",
  "SKILL.md",
);
const reference = join(dirname(skill), "references", "mcp.md");
const upstreamTest = join(kit, "skill", "tests", "skills", "test_simplepost_skill.py");
const manifest = join(kit, "mcp", "optional-mcps", "simplepost", "manifest.yaml");
const source = JSON.parse(readFileSync(join(kit, "source.json"), "utf8"));

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const text = (path) => readFileSync(path, "utf8");
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

for (const [path, expected] of Object.entries(source.canonicalFiles)) {
  const absolute = join(repo, path);
  check(existsSync(absolute), `Missing canonical source: ${path}`);
  if (existsSync(absolute)) {
    check(
      sha256(absolute) === expected,
      `Canonical source changed: ${path}. Review the Hermes adapter and refresh source.json.`,
    );
  }
}

for (const path of [skill, reference, upstreamTest, manifest]) {
  check(existsSync(path), `Missing submission file: ${relative(repo, path)}`);
}

if (existsSync(skill)) {
  const body = text(skill);
  const frontmatter = body.match(/^---\n([\s\S]*?)\n---\n/);
  check(frontmatter, "Hermes SKILL.md has valid leading frontmatter delimiters.");

  if (frontmatter) {
    const metadata = frontmatter[1];
    const description = metadata.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
    for (const field of ["name", "description", "version", "author", "license", "platforms"]) {
      check(new RegExp(`^${field}:`, "m").test(metadata), `Hermes skill is missing ${field}.`);
    }
    check(description.length <= 60, `Hermes skill description is ${description.length} characters.`);
    check(description.endsWith("."), "Hermes skill description must end with a period.");
    check(/tags:\s*\[/.test(metadata), "Hermes skill is missing metadata.hermes.tags.");
    check(/related_skills:\s*\[/.test(metadata), "Hermes skill is missing related_skills.");
  }

  const sections = [
    "# SimplePost Skill",
    "## When to Use",
    "## Prerequisites",
    "## How to Run",
    "## Quick Reference",
    "## Procedure",
    "## Pitfalls",
    "## Verification",
  ];
  let cursor = -1;
  for (const section of sections) {
    const next = body.indexOf(section);
    check(next > cursor, `Missing or out-of-order section: ${section}`);
    cursor = next;
  }

  for (const required of [
    "https://app.simplepost.social/mcp",
    "`list_accounts` before a write",
    "unique `idempotencyKey`",
    "Never use a new key for an uncertain write",
    "per-account or per-thread failures",
  ]) {
    check(body.includes(required), `Hermes skill is missing workflow contract: ${required}`);
  }
}

if (existsSync(manifest)) {
  const body = text(manifest);
  for (const required of [
    "manifest_version: 1",
    "name: simplepost",
    "source: https://docs.simplepost.social/mcp",
    "type: http",
    "url: https://app.simplepost.social/mcp",
    "type: oauth",
    "hermes mcp login simplepost",
  ]) {
    check(body.includes(required), `Hermes MCP manifest is missing: ${required}`);
  }
  check(!/\b(command|args|bootstrap|client_secret):/.test(body), "Hosted MCP manifest must not execute or embed secrets.");
}

const skillPayloadFiles = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else skillPayloadFiles.push(relative(join(kit, "skill"), path));
  }
};
walk(join(kit, "skill"));
check(
  !skillPayloadFiles.some((path) => path.endsWith("agents/openai.yaml")),
  "The Hermes payload must not vendor agents/openai.yaml.",
);

if (failures.length) {
  console.error("Hermes submission validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Hermes submission payload is internally consistent.");
console.log(`Canonical source commit: ${source.sourceCommit}`);
console.log(`Prepared skill files: ${skillPayloadFiles.length}`);
console.log("Prepared MCP manifests: 1");
