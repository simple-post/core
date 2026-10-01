import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "dist", "plugin-submission");

const submission = JSON.parse(readFileSync(join(root, "scheduler", "chatgpt-app-submission.json"), "utf8"));
const listing = JSON.parse(readFileSync(join(root, "docs", "plugin-submission", "listing.json"), "utf8"));
const packageName = listing.packageName;
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(packageName) || packageName.length > 64) throw new Error("Invalid public package identity");
const packagePath = join(output, packageName);
const legacyExports = process.argv.includes("--legacy-exports");
const source = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8"));
const fail = (message) => {
  throw new Error(message);
};
const info = submission.app_info;
if (info.subtitle.length > 30 || info.description.length > 4000) fail("Listing length exceeds submission limits.");
if (submission.test_cases.length !== 5 || submission.negative_test_cases.length !== 3)
  fail("Require five positive and three negative cases.");
for (const [name, tool] of Object.entries(submission.tools)) {
  for (const hint of ["readOnlyHint", "openWorldHint", "destructiveHint", "idempotentHint"]) {
    if (typeof tool.annotations[hint] !== "boolean") fail(`${name}: missing ${hint}`);
  }
}
for (const key of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) {
  const url = new URL(listing[key]);
  if (url.protocol !== "https:" || url.username || url.password) fail(`${key}: invalid public URL`);
}
if (!/^\d+\.\d+\.\d+$/.test(listing.version)) fail("Public version must be semantic.");
if (
  listing.defaultPrompt.length > 3 ||
  listing.defaultPrompt.some((prompt) => !prompt.trim() || prompt.length > 128 || /\n/.test(prompt))
)
  fail("Invalid starter prompts.");

mkdirSync(output, { recursive: true });
rmSync(packagePath, { recursive: true, force: true });
mkdirSync(join(packagePath, "assets"), { recursive: true });
cpSync(join(root, "skills", "simplepost"), join(packagePath, "skills", "simplepost"), { recursive: true });
cpSync(join(root, "skills", "setup"), join(packagePath, "skills", "setup"), { recursive: true });
cpSync(join(root, "scheduler", "public", "simplepost-logo.png"), join(packagePath, "assets", "icon.png"));
const review = {
  test_cases: {
    positive: submission.test_cases.map((test) => ({
      description: test.description,
      prompt: test.user_prompt,
      tools_triggered: test.tools_triggered,
      expected_behavior: test.expected_output,
    })),
    negative: submission.negative_test_cases.map((test) => ({
      description: `${test.description} Expected: ${test.expected_output}`,
      prompt: test.user_prompt,
    })),
  },
};
// Only verified new recordings and explicit commerce answers belong in the public upload.
if (listing.demo_recording_url) review.demo_recording_url = listing.demo_recording_url;
if (typeof listing.commerce === "boolean") review.commerce = listing.commerce;
if (listing.commerce_description) review.commerce_description = listing.commerce_description;
const plugin = {
  $schema: source.$schema,
  name: packageName,
  version: listing.version,
  description: source.description,
  author: { ...source.author, name: listing.developerName },
  homepage: source.homepage,
  repository: source.repository,
  license: source.license,
  keywords: source.keywords,
  extensions: {
    "com.openai": {
      onboardingSkill: "./skills/setup/SKILL.md",
      interface: {
        displayName: info.display_name,
        shortDescription: info.subtitle,
        longDescription: info.description,
        developerName: listing.developerName,
        category: listing.category,
        defaultPrompt: listing.defaultPrompt,
        websiteURL: listing.websiteURL,
        supportURL: listing.supportURL,
        privacyPolicyURL: listing.privacyPolicyURL,
        termsOfServiceURL: listing.termsOfServiceURL,
        logo: "./assets/icon.png",
        composerIcon: "./assets/icon.png",
      },
      review,
      publication: { release_notes: listing.release_notes, countries: listing.countries },
    },
  },
};
writeFileSync(join(packagePath, "plugin.json"), JSON.stringify(plugin, null, 2) + "\n");
writeFileSync(
  join(packagePath, "mcp.json"),
  JSON.stringify(
    {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: { simplepost: { type: "streamable-http", url: "https://app.simplepost.social/mcp" } },
    },
    null,
    2,
  ) + "\n",
);
if (legacyExports) writeFileSync(join(output, "chatgpt-app-submission.json"), JSON.stringify(submission, null, 2) + "\n");
const archive = join(output, `simplepost-${listing.version}-review-draft.zip`);
rmSync(archive, { force: true });
execFileSync("zip", ["-qr", archive, packageName], { cwd: output });
for (const name of legacyExports ? ["setup", "simplepost"] : []) {
  const skillArchive = join(output, `${name}-skill-${listing.version}.zip`);
  rmSync(skillArchive, { force: true });
  execFileSync("zip", ["-qr", skillArchive, name], { cwd: join(packagePath, "skills") });
}
const files = [];
function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isSymbolicLink()) fail("No symlinks in upload.");
    if (entry.isDirectory()) walk(full);
    else files.push(relative(packagePath, full));
  }
}
walk(packagePath);
if (files.some((file) => /(^|\/)\.app\.json$|(^|\/)\.env|node_modules|\.codex-plugin/.test(file)))
  fail("Unexpected private or compatibility files in public upload.");
const parsed = JSON.parse(execFileSync("unzip", ["-p", archive, `${packageName}/plugin.json`], { encoding: "utf8" }));
if (parsed.apps != null || parsed.extensions["com.openai"].apps != null || parsed.skills != null)
  fail("Public manifest contains private app bindings or non-portable skill discovery.");
const inventory = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" });
execFileSync(process.execPath, [join(root, "scripts", "validate-plugin-submission.mjs"), archive], { stdio: "inherit" });
const missing = [];
if (!listing.demo_recording_url) missing.push("Replacement demo recording URL and verified playback");
if (typeof listing.commerce !== "boolean") missing.push("Confirmed commerce declaration");
missing.push("Live host review cases, production extension rollout/scan, reviewer access, and developer attestations");
writeFileSync(
  join(output, "PACKAGE-STATUS.md"),
  `# SimplePost ${listing.version} review draft\n\nPrepared for the existing SimplePost portal draft. This ZIP has not been submitted and is not yet ready to submit.\n\nSHA-256: \`${createHash("sha256").update(readFileSync(archive)).digest("hex")}\`\n\nRemaining:\n${missing.map((item) => `- ${item}`).join("\n")}\n\nArchive inventory:\n\n\`\`\`text\n${inventory}\`\`\`\n`,
);
console.log(
  JSON.stringify(
    {
      archive,
      ...(legacyExports ? { legacyImport: join(output, "chatgpt-app-submission.json") } : {}),
      files: files.length,
      tools: Object.keys(submission.tools).length,
      missing,
    },
    null,
    2,
  ),
);
