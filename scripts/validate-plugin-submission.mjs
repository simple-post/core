import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Inspect the actual upload, not just its source tree. This is local structural
// validation; portal scans, live tests and policy attestations remain separate.
const archive = resolve(process.argv[2] ?? "dist/plugin-submission/simplepost-3.0.0-review-draft.zip");
const packageName = "app-69f882652190819192ab1c88f1218795";
const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n");
assert.equal(new Set(entries).size, entries.length, "Duplicate ZIP entries");
for (const entry of entries) {
  assert(entry.startsWith(`${packageName}/`) && !entry.split("/").includes(".."), `Unexpected path: ${entry}`);
  assert(!/(^|\/)(\.app\.json|\.env[^/]*|\.git|node_modules|\.codex-plugin)(\/|$)/.test(entry), `Private file: ${entry}`);
}
const read = (path) => {
  assert(entries.includes(`${packageName}/${path}`), `Missing archive file: ${path}`);
  return execFileSync("unzip", ["-p", archive, `${packageName}/${path}`], { maxBuffer: 6 * 1024 * 1024 });
};
const json = (path) => JSON.parse(read(path).toString("utf8"));
const text = (value, max, label) => {
  assert(typeof value === "string" && value.trim() && value.length <= max, `Invalid ${label}`);
};
const url = (value, label) => {
  text(value, 1024, label);
  const parsed = new URL(value);
  assert(parsed.protocol === "https:" && !parsed.username && !parsed.password, `Invalid ${label}`);
};
const plugin = json("plugin.json");
assert.equal(plugin.name, packageName);
assert(/^\d+\.\d+\.\d+$/.test(plugin.version), "Invalid version");
const extension = plugin.extensions["com.openai"];
for (const key of ["apps", "skills", "mcpServers", "interface"]) assert(plugin[key] == null, `Nonportable ${key}`);
assert(extension.apps == null, "Private app binding");
const listing = extension.interface;
for (const [key, max] of Object.entries({ displayName: 30, shortDescription: 30, longDescription: 4000, developerName: 80, category: 120 })) text(listing[key], max, key);
for (const key of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) url(listing[key], key);
assert(Array.isArray(listing.defaultPrompt) && listing.defaultPrompt.length <= 3, "Invalid starter prompts");
const prompts = listing.defaultPrompt.map((prompt) => {
  text(prompt, 128, "starter prompt");
  assert(!/[\r\n\t@]/.test(prompt), "Starter must be one line without app mentions");
  return prompt.trim().replace(/\s+/g, " ");
});
assert.equal(new Set(prompts).size, prompts.length, "Duplicate starter prompts");
for (const key of ["logo", "composerIcon"]) {
  assert(listing[key].startsWith("./assets/"), `Invalid ${key} reference`);
  const image = read(listing[key].slice(2));
  assert(image.length <= 5 * 1024 * 1024, "Icon exceeds 5 MiB");
  assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "Expected PNG icon");
  const width = image.readUInt32BE(16);
  assert(width >= 256 && width <= 4096 && width === image.readUInt32BE(20), "Invalid square icon dimensions");
}
assert.equal(extension.onboardingSkill, "./skills/setup/SKILL.md");
for (const name of ["setup", "simplepost"]) {
  const skill = read(`skills/${name}/SKILL.md`).toString("utf8");
  assert(skill.startsWith("---\n") && skill.includes(`\nname: ${name}\n`) && /\ndescription: .+/.test(skill), `Invalid skill: ${name}`);
}
const servers = json("mcp.json").mcpServers;
assert.deepEqual(Object.keys(servers), ["simplepost"], "Expected one MCP server");
assert.equal(servers.simplepost.type, "streamable-http");
assert.equal(servers.simplepost.url, "https://app.simplepost.social/mcp");
const review = extension.review;
assert(review.test_credentials == null && review.reviewer_instructions == null, "Reviewer access belongs in the portal");
assert.equal(review.test_cases.positive.length, 5);
assert.equal(review.test_cases.negative.length, 3);
for (const [kind, cases] of Object.entries(review.test_cases)) {
  for (const test of cases) {
    text(test.description, 4000, "case description");
    text(test.prompt, 4000, "case prompt");
    if (kind === "positive") {
      text(test.tools_triggered, 4000, "expected tools");
      text(test.expected_behavior, 8000, "expected behavior");
    }
  }
}
if (review.demo_recording_url != null) url(review.demo_recording_url, "demo recording");
if (review.commerce != null) assert.equal(typeof review.commerce, "boolean");
text(extension.publication.release_notes, 4000, "release notes");
assert(Array.isArray(extension.publication.countries), "Missing country targeting");
assert(extension.publication.countries.every((country) => /^[A-Z]{2}$/.test(country)), "Invalid country format");
console.log("ZIP structure, listing, icons, skills, MCP endpoint and 5+3 review cases validated. This does not establish submission readiness.");
