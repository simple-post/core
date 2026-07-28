import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const schedulerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.resolve(schedulerRoot, "public/mcp-widgets");

await mkdir(outdir, { recursive: true });
await build({
  entryPoints: {
    schedule: path.resolve(schedulerRoot, "mcp-ui/schedule.tsx"),
    "post-preview": path.resolve(schedulerRoot, "mcp-ui/post-preview.tsx"),
  },
  bundle: true,
  entryNames: "[name]",
  assetNames: "[name]",
  outdir,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  sourcemap: false,
  minify: true,
  legalComments: "none",
  logLevel: "info",
});
