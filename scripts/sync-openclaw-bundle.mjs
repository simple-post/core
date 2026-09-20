import { cp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "skills", "simplepost");
const target = path.join(root, "integrations", "openclaw", "skills", "simplepost");
const checkOnly = process.argv.includes("--check");

async function filesBelow(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(path.join(directory, entry.name), relative)));
    else files.push(relative);
  }
  return files.sort();
}

async function assertSynced() {
  const [sourceFiles, targetFiles] = await Promise.all([filesBelow(source), filesBelow(target)]);
  if (JSON.stringify(sourceFiles) !== JSON.stringify(targetFiles)) {
    throw new Error("OpenClaw skill file list differs; run this script without --check");
  }
  for (const relative of sourceFiles) {
    const [left, right] = await Promise.all([
      readFile(path.join(source, relative)),
      readFile(path.join(target, relative)),
    ]);
    if (!left.equals(right)) throw new Error(`${relative} differs; run this script without --check`);
  }
  console.log("OpenClaw bundle skill matches skills/simplepost");
}

if (checkOnly) {
  await assertSynced();
} else {
  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });
  await assertSynced();
}
