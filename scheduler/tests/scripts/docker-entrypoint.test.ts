import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const entrypoint = path.resolve(__dirname, "../../scripts/docker-entrypoint.mjs");

it("resolves the actual installed Prisma CLI from the scheduler workspace", () => {
  const require = createRequire(entrypoint);
  expect(existsSync(require.resolve("prisma/build/index.js"))).toBe(true);
  expect(existsSync(require.resolve("next/dist/bin/next"))).toBe(true);
});

it.each([
  ["hoisted", 0],
  ["hoisted", 7],
  ["workspace", 0],
  ["workspace", 7],
] as const)("starts correctly with %s dependencies and migration exit %i", (layout, migrationExit) => {
  const directory = mkdtempSync(path.join(tmpdir(), "simplepost-entrypoint-"));
  try {
    const work = path.join(directory, "scheduler");
    mkdirSync(work);
    const dependencies =
      layout === "workspace" ? path.join(work, "node_modules") : path.join(directory, "node_modules");
    mkdirSync(path.join(dependencies, "prisma/build"), { recursive: true });
    mkdirSync(path.join(directory, "node_modules/next/dist/bin"), { recursive: true });
    writeFileSync(
      path.join(dependencies, "prisma/package.json"),
      JSON.stringify({ name: "prisma", exports: { "./build/index.js": "./build/index.js" } }),
    );
    writeFileSync(
      path.join(dependencies, "prisma/build/index.js"),
      `console.log("migration:" + process.argv.slice(2).join(" ")); process.exit(${migrationExit});`,
    );
    writeFileSync(
      path.join(directory, "node_modules/next/dist/bin/next"),
      'console.log("next:" + process.argv.slice(2).join(" "));',
    );
    writeFileSync(path.join(work, "docker-entrypoint.mjs"), readFileSync(entrypoint, "utf8"));
    const result = spawnSync(process.execPath, ["docker-entrypoint.mjs"], {
      cwd: work,
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(migrationExit);
    expect(result.stdout).toContain("migration:migrate deploy --schema prisma/schema.prisma");
    if (migrationExit === 0) expect(result.stdout).toContain("next:start");
    else expect(result.stdout).not.toContain("next:start");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
