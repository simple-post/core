import { test, expect } from "@playwright/test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { McpClient, mcpCreate } from "../src/adapters/mcp.js";
import { materialize, catalog } from "../src/catalog.js";
import { serve, config, account } from "./helpers.js";
for (const id of [
  "tiktok.smoke",
  "telegram.album-photos",
  "telegram.album-videos",
  "telegram.album-mixed",
  "telegram.schedule",
])
  test(`actual MCP HTTP transport preserves ${id} options and attachment order`, async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const a = account(),
      s = materialize(
        {
          ...catalog.find((c) => c.id === id)!,
          options: id.startsWith("tiktok")
            ? { privacyLevel: "SELF_ONLY", autoAddMusic: false, description: "" }
            : { parseMode: "HTML" },
        },
        a,
        "mcp",
        "r",
        "https://media.example.com",
      );
    const host = await serve(async (req, res, body) => {
      expect(req.headers.authorization).toBe("Bearer fake-mcp-token");
      const server = new McpServer({ name: "test-platform-boundary", version: "1.0.0" });
      for (const name of [
        "list_accounts",
        "create_post",
        "validate_post",
        "inspect_posts",
        "upload_media",
        "update_scheduled_post",
        "discard_scheduled_post",
      ])
        server.registerTool(name, { inputSchema: z.object({}).passthrough() }, async (args) => {
          calls.push({ name, args });
          const file = args.file as { file_name: string; file_id: string } | undefined;
          const result =
            name === "upload_media"
              ? {
                  url: `https://media.example.com/${file!.file_id}`,
                  type: file!.file_name.endsWith("mp4") ? "video" : "image",
                  filename: file!.file_name,
                  size: 123,
                }
              : name === "create_post"
                ? {
                    post: { id: "post-1", status: "published", accountOptions: args.accountOptions },
                    postingResults: [{ accountId: a.id, success: true, postId: "123" }],
                  }
                : {};
          return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
        });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      res.on("close", () => {
        void server.close();
      });
      await transport.handleRequest(req, res, body);
    });
    process.env.E2E_MCP_TOKEN = "fake-mcp-token";
    const client = new McpClient(config({ baseUrl: host.url }));
    try {
      await client.connect();
      let recorded = false;
      let schedulePrepared = false;
      if (s.mode === "schedule") s.scheduledFor = "2000-01-01T00:00:00.000Z";
      const result = await mcpCreate(
        client,
        s,
        a,
        s.media.map((key) => {
          const video = key === "video" || key === "silentVideo";
          return {
            type: video ? ("video" as const) : ("image" as const),
            url: `https://media.example.com/${key}`,
            path: "/fake",
            filename: `${key}.${video ? "mp4" : "jpg"}`,
            size: 123,
            sha256: "test",
          };
        }),
        "stable-key",
        async () => {
          recorded = true;
        },
        async () => {
          expect(calls.map((c) => c.name)).toEqual(s.media.map(() => "upload_media"));
          s.scheduledFor = "2026-09-06T00:01:00.000Z";
          schedulePrepared = true;
        },
      );
      expect(recorded).toBe(true);
      expect(schedulePrepared).toBe(s.mode === "schedule");
      if (s.mode === "schedule")
        expect(calls.at(-1)!.args).toMatchObject({
          postingMode: "schedule",
          scheduledFor: "2026-09-06T00:01:00.000Z",
        });
      expect(result.results[0].postId).toBe("123");
      expect(calls.map((c) => c.name)).toEqual([...s.media.map(() => "upload_media"), "create_post"]);
      expect(calls.at(-1)!.args).toMatchObject({
        accountIds: [a.id],
        idempotencyKey: "stable-key",
        accountOptions: { [a.id]: s.options },
        media: s.media.map((key, index) => ({
          url: `https://media.example.com/${s.token}-${index}`,
          size: 123,
          type: key === "video" || key === "silentVideo" ? "video" : "image",
        })),
      });
    } finally {
      await client.close();
      await host.close();
      delete process.env.E2E_MCP_TOKEN;
    }
  });

for (const mode of ["valid-error", "wrong-code", "wrong-field", "wrong-account", "warning-only", "provider-error"])
  test(`MCP validation evidence: ${mode} cannot hide a publishing failure`, async () => {
    const calls: string[] = [];
    const a = account();
    const scenario = catalog.find((s) => s.id === "instagram.validation-portrait-ratio")!;
    const s = materialize(scenario, a, "mcp", "validation", "https://media.example.com");
    const host = await serve(async (req, res, body) => {
      const server = new McpServer({ name: "validation-evidence", version: "1.0.0" });
      for (const name of [
        "list_accounts",
        "create_post",
        "validate_post",
        "inspect_posts",
        "upload_media",
        "update_scheduled_post",
        "discard_scheduled_post",
      ])
        server.registerTool(name, { inputSchema: z.object({}).passthrough() }, async () => {
          calls.push(name);
          const issue = {
            ...s.expectedIssue,
            severity: mode === "warning-only" ? "warning" : "error",
            message: "aspect_ratio unsupported",
            ...(mode === "wrong-code" ? { code: "PUBLISH_REJECTED" } : {}),
            ...(mode === "wrong-field" ? { field: "media[1]" } : {}),
          };
          const result = {
            isValid: false,
            accounts: [{ accountId: mode === "wrong-account" ? "other" : a.id, isValid: false, errors: [issue] }],
          };
          return mode === "provider-error"
            ? { isError: true, content: [{ type: "text" as const, text: "Platform rejected aspect_ratio" }] }
            : { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
        });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      res.on("close", () => {
        void server.close();
      });
      await transport.handleRequest(req, res, body);
    });
    process.env.E2E_MCP_TOKEN = "fake-mcp-token";
    const client = new McpClient(config({ baseUrl: host.url }));
    try {
      await client.connect();
      const result = mcpCreate(client, s, a, [], "validation", async () => {
        throw new Error("Must not create a post");
      });
      if (mode === "valid-error") await expect(result).resolves.toEqual({ status: "validation-rejected", results: [] });
      else await expect(result).rejects.toThrow();
      expect(calls).toEqual(["validate_post"]);
    } finally {
      await client.close();
      await host.close();
      delete process.env.E2E_MCP_TOKEN;
    }
  });
