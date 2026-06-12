import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/validation.ts", "src/media-types.ts", "src/platform-names.ts"],
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
