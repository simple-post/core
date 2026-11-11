import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { claudeSkillFiles, destination, root, syncClaudeSkill, treeFiles } from "./sync-claude-skill.mjs";

test("Claude adapter contains only the hosted connector workflow and valid local references", async () => {
  const files = await claudeSkillFiles();
  assert.deepEqual([...files.keys()].sort(), ["SKILL.md", "agents/openai.yaml", "references/mcp.md"]);
  for (const [relative, content] of files) {
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^https:\/\//.test(target) || target.startsWith("#")) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), target));
      assert(files.has(resolved), `Unpackaged reference: ${relative} -> ${target}`);
    }
    assert(!/\$(?:\{)?[A-Z][A-Z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)/.test(content), `Environment credential example in ${relative}`);
    assert(!/```(?:bash|sh|shell)|references\/(?:cli|sdk|scheduler|http-server)\.md/.test(content), `Local execution route in ${relative}`);
  }
  assert(files.get("SKILL.md").includes("https://app.simplepost.social/mcp"));
  assert(files.get("references/mcp.md").includes("idempotencyKey"));
});

test("generated Claude and OpenClaw adapters are current", async () => {
  await syncClaudeSkill({ check: true });
  assert.deepEqual(await treeFiles(destination), [...(await claudeSkillFiles()).keys()].sort());
  execFileSync(process.execPath, [path.join(root, "scripts/sync-openclaw-bundle.mjs"), "--check"]);
});

test("OpenClaw release metadata agrees and declares no executable extension", async () => {
  const base = path.join(root, "integrations/openclaw");
  const manifests = await Promise.all(["package.json", "plugin.json", ".codex-plugin/plugin.json"].map(async file => JSON.parse(await readFile(path.join(base, file), "utf8"))));
  assert.equal(new Set(manifests.map(item => item.version)).size, 1);
  assert.equal(manifests[0].openclaw?.extensions, undefined);
  for (const file of ["mcp.json", ".mcp.json"]) {
    const config = JSON.parse(await readFile(path.join(base, file), "utf8"));
    assert.equal(config.mcpServers.simplepost.url, "https://app.simplepost.social/mcp");
    assert.equal(config.mcpServers.simplepost.command, undefined);
    assert.equal(config.mcpServers.simplepost.headers, undefined);
  }
});
