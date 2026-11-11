import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const destination = path.join(root, "integrations/claude/skills/simplepost");

function replaceRequired(text, before, after) {
  if (!text.includes(before)) throw new Error(`Canonical skill changed; review Claude adaptation: ${before}`);
  return text.replace(before, after);
}

export async function claudeSkillFiles() {
  let skill = await readFile(path.join(root, "skills/simplepost/SKILL.md"), "utf8");
  if (!/^description: .+$/m.test(skill)) throw new Error("Canonical description missing");
  skill = skill.replace(/^description: .+$/m, "description: Publish, schedule, draft, preview, inspect, or manage social posts with SimplePost through its hosted OAuth MCP connector. Use for connected-account publishing and calendar tasks; not generic copywriting, engagement analytics, private messages, or local credential setup.");
  const start = skill.indexOf("## Choose the interface\n");
  const end = skill.indexOf("## Posting workflow\n");
  if (start < 0 || end <= start) throw new Error("Canonical interface routing changed");
  skill = skill.slice(0, start) + "## Hosted connector\n\nUse only the SimplePost remote OAuth MCP connector at `https://app.simplepost.social/mcp`. Read [references/mcp.md](references/mcp.md) for the workflow. Social credentials remain in SimplePost; the client handles OAuth authorization. If authorization fails, stop and ask the user to reconnect through the client's normal OAuth UI. Never fall back to local credentials or ask for tokens in chat.\n\nThis directory package does not run a local server, CLI, SDK, hook, or shell command. Developer integration documentation is available separately at [docs.simplepost.social](https://docs.simplepost.social); it is not part of this plugin's execution workflow.\n\n" + skill.slice(end);
  skill = replaceRequired(skill, "and intent, choose the interface that fits the environment,", "and intent, use the hosted connector,");
  skill = replaceRequired(skill, "With MCP, call `list_accounts`; with CLI, run `simplepost account`.", "Call `list_accounts`.");
  skill = replaceRequired(skill, "MCP and HTTP require public or SimplePost-managed URLs. The CLI and SDK can accept local files.", "MCP requires public or SimplePost-managed URLs; use only file parameters supplied by the current client for attachments.");
  skill = replaceRequired(skill, "Use OAuth, environment variables, the CLI secret store, or server-side account storage.", "Use only the client's normal OAuth UI and SimplePost's server-side account storage.");
  skill = replaceRequired(skill, "Local integration examples are for an explicitly requested developer setup, not permission to collect existing credentials. The user supplies secrets through their trusted application or secret manager; the assistant must not display them.", "This plugin needs no user-supplied API keys or local secrets.");

  let mcp = await readFile(path.join(root, "skills/simplepost/references/mcp.md"), "utf8");
  const setupStart = mcp.indexOf("## Setup\n");
  const setupEnd = mcp.indexOf("## Tool Workflow\n");
  if (setupStart < 0 || setupEnd <= setupStart) throw new Error("Canonical MCP setup changed");
  mcp = mcp.slice(0, setupStart) + "## Setup\n\nThe bundled connector uses `https://app.simplepost.social/mcp`. Complete sign-in through the client's normal OAuth UI. Connect social destinations in [SimplePost](https://app.simplepost.social) or use the platform-specific connection link returned by `list_accounts`. Never collect API keys, passwords, or access tokens in chat or read them from the user's machine. If linking fails, report it and stop; there is no local-credential fallback.\n\n" + mcp.slice(setupEnd);
  return new Map([
    ["SKILL.md", skill],
    ["references/mcp.md", mcp],
    ["agents/openai.yaml", await readFile(path.join(root, "skills/simplepost/agents/openai.yaml"), "utf8")],
  ]);
}

export async function treeFiles(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await treeFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error(`Non-regular packaged file: ${relative}`);
  }
  return result.sort();
}

export async function syncClaudeSkill({ check = false } = {}) {
  const expected = await claudeSkillFiles();
  if (check) {
    const actual = await treeFiles(destination);
    if (JSON.stringify(actual) !== JSON.stringify([...expected.keys()].sort())) throw new Error("Claude skill file set differs; run node scripts/sync-claude-skill.mjs");
    for (const [relative, content] of expected) {
      if (await readFile(path.join(destination, relative), "utf8") !== content) throw new Error(`Claude ${relative} is stale`);
    }
  } else {
    // Generated directory owned by this script, never a caller-supplied path.
    await rm(destination, { recursive: true, force: true });
    for (const [relative, content] of expected) {
      await mkdir(path.dirname(path.join(destination, relative)), { recursive: true });
      await writeFile(path.join(destination, relative), content);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await syncClaudeSkill({ check: process.argv.includes("--check") });
  console.log("Claude OAuth-only skill matches the canonical core skill");
}
