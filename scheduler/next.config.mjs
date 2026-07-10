import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow the native image-processing package to load outside the bundle.
  serverExternalPackages: ["sharp"],

  // Enable Turbopack (default in Next.js 16)
  // This app imports the sibling SDK workspace. Pinning the root prevents
  // Next.js from walking up to an unrelated parent lockfile.
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },

  allowedDevOrigins: ["http://localhost:3000", "vlad.creafexlab.com"],
};

export default nextConfig;
