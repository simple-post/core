import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { configuredAppRoot } from "../src/app-root.js";

// Disposable local PostgreSQL only. Never consume a configured application DATABASE_URL.
const root = configuredAppRoot();
console.log(`Reliability application root: ${root}`);
const directory = await mkdtemp(path.join(tmpdir(), "simplepost-reliability-"));
const data = path.join(directory, "data");
const log = path.join(directory, "postgres.log");
const env: NodeJS.ProcessEnv = Object.fromEntries(
  ["PATH", "HOME", "USER", "TMPDIR", "SYSTEMROOT", "NODE_OPTIONS"].flatMap((key) =>
    process.env[key] ? [[key, process.env[key]!]] : [],
  ),
);
env.PGCONNECT_TIMEOUT = "5";
env.LC_ALL = "C";
let active: ChildProcess | undefined;
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  active?.kill("SIGTERM");
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
async function run(command: string, args: string[], cwd = root, cleanup = false) {
  if (interrupted && !cleanup) throw new Error("Reliability run interrupted");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    active = child;
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code ?? signal}`)),
    );
  });
}
let started = false;
try {
  for (const command of ["initdb", "pg_ctl", "createdb"])
    await run(command, ["--version"]).catch(() => {
      throw new Error(
        `Install local PostgreSQL command-line tools (${command} must be on PATH) to run the isolated reliability tests.`,
      );
    });
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Cannot allocate a local PostgreSQL port");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await run("initdb", ["-D", data, "-U", "e2e", "-A", "trust", "--no-locale", "-E", "UTF8"]);
  // No Unix socket and only a loopback listener. The private cluster is removed after the run.
  await run("pg_ctl", ["-D", data, "-l", log, "-o", `-h 127.0.0.1 -p ${port} -k ''`, "-w", "start"]);
  started = true;
  await run("createdb", ["-h", "127.0.0.1", "-p", String(port), "-U", "e2e", "simplepost_review"]);
  env.DATABASE_URL = `postgresql://e2e@127.0.0.1:${port}/simplepost_review`;
  env.INTEGRATION_DATABASE_URL = env.DATABASE_URL;
  await run("yarn", ["workspace", "@simple-post/scheduler", "prisma", "generate"]);
  await run("yarn", ["workspace", "@simple-post/scheduler", "prisma", "migrate", "deploy"]);
  await run("yarn", [
    "workspace",
    "@simple-post/sdk",
    "test",
    "--runInBand",
    "TelegramPublisher",
    "InstagramPublisher",
    "PublishingApi",
    "Credentials",
    "StorageDeletion",
  ]);
  await run("yarn", [
    "workspace",
    "@simple-post/scheduler",
    "test",
    "--runInBand",
    "tests/lib/db/posts.test.ts",
    "tests/lib/posting/batch-failures.test.ts",
    "tests/lib/posting/scheduled-dispatcher.test.ts",
    "tests/lib/mcp/post-options.test.ts",
    "tests/scripts/docker-entrypoint.test.ts",
  ]);
  await run("yarn", [
    "workspace",
    "@simple-post/scheduler",
    "jest",
    "-c",
    "jest.integration.config.cjs",
    "--runInBand",
  ]);
  console.log("Local publishing reliability checks passed. No live social accounts were used.");
} catch (error) {
  if (!started) console.error(await readFile(log, "utf8").catch(() => ""));
  throw error;
} finally {
  // If shutdown fails, preserve the cluster for diagnosis rather than deleting a running database.
  if (started || existsSync(path.join(data, "postmaster.pid")))
    await run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], root, true);
  await rm(directory, { recursive: true, force: true });
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
