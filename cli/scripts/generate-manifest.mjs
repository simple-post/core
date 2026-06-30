import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Config } from "@oclif/core";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(scriptDir, "..");
const manifestPath = path.join(cliRoot, "oclif.manifest.json");

const config = await Config.load({ ignoreManifest: true, root: cliRoot });
const manifest = config.rootPlugin.manifest;

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
