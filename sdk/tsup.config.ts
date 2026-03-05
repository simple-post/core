import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  target: "node16",
  outDir: "dist",
  treeshake: true,
  external: [
    "@aws-sdk/client-s3",
    "@aws-sdk/lib-storage",
    "@aws-sdk/s3-request-presigner",
    "axios",
    "form-data",
    "googleapis",
    "twitter-api-v2",
    "uuid",
    "zod",
  ],
});
