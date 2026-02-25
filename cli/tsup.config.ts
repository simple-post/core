import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  banner: {
    js: "#!/usr/bin/env node",
  },
});
