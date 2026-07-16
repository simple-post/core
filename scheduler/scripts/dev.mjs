import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, watch } from "node:fs";
import { fileURLToPath } from "node:url";

const schedulerRoot = fileURLToPath(new URL("../", import.meta.url));
const coreRoot = fileURLToPath(new URL("../../", import.meta.url));
const previewRoot = fileURLToPath(new URL("../../../preview/", import.meta.url));
const localRoot = `${coreRoot}node_modules/@simple-post/`;
const packages = [
  { name: "@simple-post/preview", source: "packages/preview/dist", target: "preview/dist" },
  { name: "@simple-post/preview-react", source: "packages/react/dist", target: "preview-react/dist" },
];
const useLocal =
  process.env.SIMPLE_POST_PREVIEW_LOCAL !== "0" &&
  packages.every(
    ({ source, target }) =>
      existsSync(`${previewRoot}${source.replace("/dist", "/src")}`) &&
      existsSync(`${localRoot}${target.replace("/dist", "/package.json")}`),
  );
const children = [];
const fileWatchers = [];
const timers = new Map();

function run(command, args, options = {}) {
  const child = spawn(command, args, { stdio: "inherit", ...options });
  children.push(child);
  return child;
}

function buildLocalPackages() {
  for (const { name } of packages) {
    const result = spawnSync("npm", ["run", "build", "--workspace", name], {
      cwd: previewRoot,
      stdio: "inherit",
    });
    if (result.status !== 0) throw new Error(`Could not build ${name}`);
  }
}

function syncPackage({ source, target }) {
  const sourcePath = `${previewRoot}${source}`;
  if (!existsSync(sourcePath)) return;
  const targetPath = `${localRoot}${target}`;
  mkdirSync(targetPath, { recursive: true });
  cpSync(sourcePath, targetPath, { recursive: true, force: true });
  const sourceEntries = new Set(readdirSync(sourcePath));
  for (const entry of readdirSync(targetPath)) {
    if (!sourceEntries.has(entry)) rmSync(`${targetPath}/${entry}`, { recursive: true, force: true });
  }
}

function scheduleSync(pkg) {
  clearTimeout(timers.get(pkg.name));
  timers.set(
    pkg.name,
    setTimeout(() => syncPackage(pkg), 60),
  );
}

function cleanup() {
  for (const watcher of fileWatchers) watcher.close();
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

if (useLocal) {
  console.warn(`[scheduler] Preparing live preview packages from ${previewRoot}`);
  buildLocalPackages();
  for (const pkg of packages) {
    syncPackage(pkg);
    fileWatchers.push(watch(`${previewRoot}${pkg.source}`, { recursive: true }, () => scheduleSync(pkg)));
    run("npm", ["run", "dev", "--workspace", pkg.name], { cwd: previewRoot });
  }
}

const next = run("next", ["dev", ...process.argv.slice(2)], {
  cwd: schedulerRoot,
  env: { ...process.env, SIMPLE_POST_PREVIEW_LOCAL: useLocal ? "1" : "0" },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanup();
    process.exitCode = 0;
  });
}

next.on("exit", (code) => {
  cleanup();
  process.exitCode = code || 0;
});

process.on("exit", cleanup);
