import { readdir } from "node:fs/promises";
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

  allowedDevOrigins: ["http://localhost:3000", "dev.simplepost.social", "vlad.creafexlab.com"],

  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "schedule.simplepost.dev" }],
        destination: "https://app.simplepost.social/:path*",
        permanent: true,
      },
    ];
  },

  async headers() {
    const directory = fileURLToPath(new URL("./public/mcp-widgets/", import.meta.url));
    const files = await readdir(directory).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    return [
      {
        source: "/mcp-widgets/:path*",
        headers: [
          {
            key: "Access-Control-Allow-Origin",
            value: "*",
          },
          {
            key: "Cross-Origin-Resource-Policy",
            value: "cross-origin",
          },
        ],
      },
      // A missing historical hash reaches the recovery route. Do not override
      // its no-store redirect with the immutable policy for existing files.
      ...files
        .filter((filename) => /^(workspace|post-editor|schedule|post-preview)-[A-Z0-9]{8}\.(js|css)$/i.test(filename))
        .map((filename) => ({
          source: `/mcp-widgets/${filename}`,
          headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
        })),
    ];
  },
};

export default nextConfig;
