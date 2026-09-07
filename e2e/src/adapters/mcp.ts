import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mcpToken, type LiveConfig, type Account } from "../config.js";
import type { Materialized, MediaFile, Receipt } from "../types.js";
import { receiptFrom } from "../http.js";
export class McpClient {
  readonly client = new Client({ name: "simplepost-live-acceptance", version: "1.0.0" });
  constructor(readonly config: LiveConfig) {}
  async connect() {
    await this.client.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", this.config.baseUrl), {
        requestInit: { headers: { Authorization: `Bearer ${mcpToken(this.config)}` }, redirect: "error" },
      }),
    );
    const tools = await this.client.listTools();
    for (const name of [
      "list_accounts",
      "create_post",
      "validate_post",
      "inspect_posts",
      "upload_media",
      "update_scheduled_post",
      "discard_scheduled_post",
    ])
      if (!tools.tools.some((t) => t.name === name)) throw new Error(`MCP discovery missing ${name}`);
  }
  async call<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await this.client.callTool({ name, arguments: args }, undefined, {
      timeout: this.config.publishTimeoutMs,
    });
    if (result.isError) throw new Error(`MCP ${name} tool error: ${JSON.stringify(result.content).slice(0, 1600)}`);
    if (result.structuredContent) return result.structuredContent as T;
    for (const block of result.content as { type: string; text?: string }[])
      if (block.type === "text" && block.text) {
        try {
          return JSON.parse(block.text) as T;
        } catch {
          /* another text block may contain JSON */
        }
      }
    throw new Error(`MCP ${name} returned no structured JSON result`);
  }
  async close() {
    await this.client.close();
  }
}
export async function mcpCreate(
  client: McpClient,
  s: Materialized,
  account: Account,
  media: MediaFile[],
  idempotencyKey: string,
  onReceipt: (r: Receipt) => Promise<void>,
  prepareSchedule?: () => Promise<void>,
): Promise<Receipt> {
  const files: Array<{ type: string; url: string; filename: string; size: number }> = [];
  for (const file of media) {
    if (s.input === "remote" || s.expectedError)
      files.push({
        type: file.type,
        url: file.url,
        filename: file.filename,
        size: file.size,
        ...(file.thumbnailUrl ? { thumbnailUrl: file.thumbnailUrl } : {}),
      });
    else {
      const uploaded = await client.call<{ url: string; type: string; filename: string; size: number }>(
        "upload_media",
        {
          file: {
            download_url: file.url,
            file_id: `${s.token}-${files.length}`,
            file_name: file.filename,
            size: file.size,
          },
        },
      );
      if (uploaded.size !== file.size || uploaded.type !== file.type)
        throw new Error("MCP upload changed file metadata unexpectedly");
      files.push({ ...uploaded, ...(file.thumbnailUrl ? { thumbnailUrl: file.thumbnailUrl } : {}) });
    }
  }
  if (s.mode === "schedule" || s.mode === "cancel") await prepareSchedule?.();
  const input = {
    message: s.mode === "draft-edit" ? `${s.message} before edit` : s.message,
    media: files,
    accountIds: [account.id],
    accountOptions: { [account.id]: s.options },
    ...(s.thread ? { thread: s.thread.map((message) => ({ message })) } : {}),
    postingMode:
      s.mode === "draft-edit" || s.mode === "draft"
        ? "draft"
        : s.mode === "schedule" || s.mode === "cancel"
          ? "schedule"
          : "now",
    ...(s.scheduledFor ? { scheduledFor: s.scheduledFor } : {}),
    idempotencyKey,
  };
  if (s.expectedError) {
    try {
      const result = await client.call<{ isValid?: boolean; summary?: { isValid?: boolean } }>("validate_post", input);
      if (result.isValid !== false && result.summary?.isValid !== false)
        throw new Error("Invalid scenario unexpectedly passed MCP validation");
      if (!new RegExp(s.expectedError, "i").test(JSON.stringify(result)))
        throw new Error("MCP rejected invalid content for an unexpected reason");
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.startsWith("MCP validate_post tool error:") ||
        !new RegExp(s.expectedError, "i").test(error.message)
      )
        throw error;
    }
    return { results: [], status: "validation-rejected" };
  }
  const result = receiptFrom(await client.call("create_post", input), account.id);
  await onReceipt(result);
  return result;
}
