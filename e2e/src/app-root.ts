import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const harnessRoot = fileURLToPath(new URL("../", import.meta.url));
type AppConfig = { appRoot?: string; cliCommand?: string };
function assertAppRoot(root: string): string {
  const manifest = path.join(root, "sdk/package.json");
  if (
    !existsSync(path.join(root, "package.json")) ||
    !existsSync(manifest) ||
    JSON.parse(readFileSync(manifest, "utf8")).name !== "@simple-post/sdk"
  )
    throw new Error(
      `App root ${root} does not contain the application workspace and @simple-post/sdk. Configure appRoot or pass --app-root.`,
    );
  return root;
}
export function resolveAppRoot(
  config: AppConfig = {},
  explicit?: string,
  localRoot = path.resolve(harnessRoot, ".."),
): string {
  const requested = explicit ?? config.appRoot;
  if (requested !== undefined) {
    if (!requested.trim()) throw new Error("appRoot must be a nonempty application checkout path");
    return assertAppRoot(path.resolve(requested));
  }
  const command = config.cliCommand;
  if (command) {
    const resolved = existsSync(command) ? realpathSync(command) : path.resolve(command);
    // cliEntry may deliberately point at a different checkout's secret reader.
    // Only the known application CLI entry identifies the contract workspace.
    if (resolved.endsWith(`${path.sep}cli${path.sep}bin${path.sep}run.js`))
      return assertAppRoot(path.resolve(path.dirname(resolved), "../.."));
  }
  return assertAppRoot(localRoot);
}
export function configuredAppRoot(
  file = process.env.E2E_CONFIG ?? path.join(harnessRoot, "config.local.json"),
  explicit: string | null = process.env.E2E_APP_ROOT ?? null,
  localRoot = path.resolve(harnessRoot, ".."),
): string {
  // Offline contract checks need only workspace locations, never accounts,
  // credentials, fixture manifests, or a complete live configuration.
  if (!existsSync(file)) {
    return resolveAppRoot({}, explicit ?? undefined, localRoot);
  }
  const saved = JSON.parse(readFileSync(file, "utf8"));
  const config: AppConfig = {};
  for (const key of ["appRoot", "cliCommand"] as const) {
    if (saved[key] !== undefined) {
      if (typeof saved[key] !== "string" || !saved[key].trim()) throw new Error(`${key} must be a nonempty path`);
      config[key] = path.resolve(path.dirname(path.resolve(file)), saved[key]);
    }
  }
  return resolveAppRoot(config, explicit ?? undefined, localRoot);
}
