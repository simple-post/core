import { createDocument } from "zod-openapi";

import { buildPaths } from "./helpers.js";
import { serverOpenApiRoutes } from "./routes.js";

export function createServerOpenApiDocument() {
  const configuredBaseUrl = process.env.SIMPLE_POST_PUBLIC_URL?.trim();
  const port = process.env.PORT || "3000";
  const baseUrl = configuredBaseUrl || `http://localhost:${port}`;

  return createDocument(
    {
      openapi: "3.1.0",
      info: {
        title: "SimplePost Self-hosted Server API",
        version: "1.0.0",
        description: "OpenAPI reference for the self-hosted SimplePost HTTP server.",
      },
      servers: [
        {
          url: baseUrl.replace(/\/$/, ""),
          description: "Self-hosted server",
        },
      ],
      tags: [
        { name: "OpenAPI", description: "Generated API reference metadata." },
        { name: "Health", description: "Server health checks." },
        { name: "Media", description: "Public uploaded media serving." },
        { name: "Accounts", description: "Configured social account listing." },
        { name: "Upload", description: "Server-side media upload." },
        { name: "Validation", description: "Platform validation for draft posts." },
        { name: "Posts", description: "Immediate publishing through configured accounts." },
      ],
      paths: buildPaths(serverOpenApiRoutes),
      components: {
        securitySchemes: {
          apiKeyAuth: {
            type: "apiKey",
            in: "header",
            name: "x-api-key",
            description: "Shared API key configured with SIMPLE_POST_API_KEY.",
          },
        },
      },
    },
    {
      cycles: "ref",
      reused: "ref",
    }
  );
}
