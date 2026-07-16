import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const useLocalPreview = process.env.NODE_ENV !== "production" && process.env.SIMPLE_POST_PREVIEW_LOCAL !== "0";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow the native image-processing package to load outside the bundle.
  serverExternalPackages: ["sharp", "@prisma/instrumentation"],

  // The development orchestrator mirrors sibling preview builds into these
  // installed package directories. Transpiling makes Turbopack watch them.
  transpilePackages: ["@simple-post/preview", "@simple-post/preview-react"],

  // Enable Turbopack (default in Next.js 16). Keep its root inside core so it
  // does not scan the sibling repository or its node_modules directory.
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },

  allowedDevOrigins: ["http://localhost:3000", "vlad.creafexlab.com"],
};

if (useLocalPreview) {
  console.info("[scheduler] Watching live preview builds from the sibling preview repository");
}

export default nextConfig;
