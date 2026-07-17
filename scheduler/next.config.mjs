import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow the native image-processing package to load outside the bundle.
  serverExternalPackages: ["sharp", "@prisma/instrumentation"],

  // Transpiling makes Turbopack watch these packages, so rebuilds reach the
  // dev server when they are portal-linked to the sibling preview repository
  // (see "yarn preview:link" in package.json).
  transpilePackages: ["@simple-post/preview", "@simple-post/preview-react"],

  // Enable Turbopack (default in Next.js 16). Keep its root inside core so it
  // does not scan the sibling repository or its node_modules directory.
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },

  allowedDevOrigins: ["http://localhost:3000", "vlad.creafexlab.com"],
};

export default nextConfig;
