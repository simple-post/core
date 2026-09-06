import { createRequire } from "node:module";
import path from "node:path";
import { configuredAppRoot } from "./app-root.js";

type AppSdk = Pick<typeof import("@simple-post/sdk"), "PostOptionsSchema"> &
  Pick<typeof import("@simple-post/sdk/validation"), "validateContentForPlatform">;
const loaded = new Map<string, AppSdk>();
export function applicationSdk(): AppSdk {
  // Resolve lazily so plan/live --config arguments take effect before inventory.
  const root = configuredAppRoot();
  const existing = loaded.get(root);
  if (existing) return existing;
  const require = createRequire(path.join(root, "package.json"));
  try {
    const sdk = {
      PostOptionsSchema: require("@simple-post/sdk").PostOptionsSchema,
      validateContentForPlatform: require("@simple-post/sdk/validation").validateContentForPlatform,
    } as AppSdk;
    loaded.set(root, sdk);
    console.log(`Contract SDK application root: ${root}`);
    return sdk;
  } catch (cause) {
    throw new Error(
      `Cannot load @simple-post/sdk from ${root}. Install that workspace and build its SDK (yarn workspace @simple-post/sdk build).`,
      { cause },
    );
  }
}
