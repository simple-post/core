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
