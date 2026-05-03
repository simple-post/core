import { createDocument } from "zod-openapi";

import { buildPaths } from "./helpers";
import { schedulerOpenApiRoutes } from "./routes";

export function createSchedulerOpenApiDocument() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return createDocument(
    {
      openapi: "3.1.0",
      info: {
        title: "SimplePost Scheduler API",
        version: "1.0.0",
        description:
          "OpenAPI reference for the Scheduler app API, OAuth/MCP support endpoints, and internal scheduler operations.",
      },
      servers: [
        {
          url: baseUrl.replace(/\/$/, ""),
          description: "Scheduler app",
        },
      ],
      tags: [
        { name: "OpenAPI", description: "Generated API reference metadata." },
        { name: "Auth", description: "Better Auth session endpoints." },
        { name: "CLI", description: "CLI authorization helpers." },
        { name: "Connect", description: "Social account connection and OAuth callback endpoints." },
        { name: "OAuth", description: "OAuth endpoints for MCP clients." },
        { name: "Accounts", description: "Connected social account management." },
        { name: "Posts", description: "Post listing, creation, publishing, scheduling, and mutation." },
        { name: "Upload", description: "Media upload and presigned upload URL endpoints." },
        { name: "Validation", description: "Platform validation for draft posts." },
        { name: "Internal", description: "Trusted infrastructure endpoints." },
        { name: "MCP", description: "Model Context Protocol Streamable HTTP endpoint." },
      ],
      paths: buildPaths(schedulerOpenApiRoutes),
      components: {
        securitySchemes: {
          cookieAuth: {
            type: "apiKey",
            in: "cookie",
            name: "session",
            description: "Browser session cookie managed by Better Auth.",
          },
          cliBearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "sp_cli",
            description: "CLI bearer token issued by the Scheduler app.",
          },
          mcpBearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "sp_mcp",
            description: "MCP bearer token issued through the Scheduler OAuth flow.",
          },
          scheduledDispatchBearer: {
            type: "http",
            scheme: "bearer",
            description: "Shared dispatch secret configured as SCHEDULED_POST_DISPATCH_SECRET.",
          },
        },
      },
    },
    {
      cycles: "ref",
      reused: "ref",
    },
  );
}
