import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { applyMcpAccessMode, DEFAULT_MCP_SCOPE, MCP_SCOPES } from "@/lib/mcp/config";
import { EXTENSION_TOOL_ANNOTATIONS } from "@/lib/mcp/extensions/tool-annotations";
import { registerTools } from "@/lib/mcp/server";
import { MCP_TOOL_ANNOTATIONS } from "@/lib/mcp/tool-annotations";

import connector from "../../../../integrations/personal-muse/connector.json";
import review from "../../../../integrations/personal-muse/tool-review.json";

jest.mock("@modelcontextprotocol/ext-apps/server", () => ({ registerAppTool: jest.fn() }));
jest.mock("@/lib/mcp/ui/resources", () => ({ registerMcpUiResources: jest.fn() }));
jest.mock("@/lib/features", () => ({ hasFeature: jest.fn().mockResolvedValue(true) }));

type Review = { class: string; scopes: string[]; extension?: boolean; effect: string };
const reviews: Record<string, Review> = review;
const annotations = { ...MCP_TOOL_ANNOTATIONS, ...EXTENSION_TOOL_ANNOTATIONS };
const readOnly = applyMcpAccessMode(DEFAULT_MCP_SCOPE, "read_only")!;

it("never turns empty consent into a legacy full-access grant", () => {
  expect(applyMcpAccessMode(" ", "read_only")).toBeNull();
  expect(applyMcpAccessMode("", "read_write")).toBeNull();
});

function register(scope = DEFAULT_MCP_SCOPE, extensions = true, fitting = true) {
  jest.mocked(registerAppTool).mockClear();
  registerTools(new McpServer({ name: "offline-muse-review", version: "1" }), {
    userId: "offline-muse-review",
    scope,
    pluginExtensionsEnabled: extensions,
    imageFittingEnabled: fitting,
  });
  return jest.mocked(registerAppTool).mock.calls;
}

function jsonSchema(schema: unknown, io: "input" | "output") {
  if (!schema) return null;
  const object = schema instanceof z.ZodType ? schema : z.object(schema as z.ZodRawShape);
  return z.toJSONSchema(object, { io, unrepresentable: "any" });
}

it("documents every current tool, including entitled extensions, with conservative risk classifications", () => {
  const calls = register();
  expect(calls.map((call) => call[1]).sort()).toEqual(Object.keys(reviews).sort());
  expect(Object.keys(reviews).sort()).toEqual(Object.keys(annotations).sort());
  for (const [, name, config] of calls) {
    const entry = reviews[name];
    expect(entry.effect.length).toBeGreaterThan(35);
    expect(["read", "write", "sensitive_write"]).toContain(entry.class);
    expect(entry.class === "read").toBe(config.annotations?.readOnlyHint);
    if (config.annotations?.destructiveHint) expect(entry.class).toBe("sensitive_write");
    expect(entry.scopes.length).toBeGreaterThan(0);
    for (const scope of entry.scopes) expect(MCP_SCOPES).toContain(scope);
    expect(jsonSchema(config.inputSchema, "input")).toMatchObject({ type: "object" });
    if (config.outputSchema) expect(jsonSchema(config.outputSchema, "output")).toMatchObject({ type: "object" });
  }
  expect(connector.mcp.readOnlyScopes.join(" ")).toBe(readOnly);
  expect(connector.mcp.readWriteScopes.join(" ")).toBe(DEFAULT_MCP_SCOPE);
});

it.each(
  Object.entries(reviews)
    .filter(([, entry]) => entry.class !== "read")
    .map(([name]) => name),
)("denies %s under read-only consent before its service executes", async (name) => {
  const call = register(readOnly).find((entry) => entry[1] === name)!;
  const result = await call[3]({} as never, {} as never);
  expect(result).toMatchObject({ isError: true });
  expect(JSON.stringify(result)).toMatch(/scope|access|permission/i);
});

it("denies supplied-content visual previews but allows the saved-preview read scope", async () => {
  const call = register(readOnly).find((entry) => entry[1] === "show_post_preview")!;
  const result = await call[3]({ message: "Unsaved", accountIds: ["test-account"] } as never, {} as never);
  expect(result).toMatchObject({ isError: true });
  expect(JSON.stringify(result)).toContain("posts:validate");
  expect(readOnly.split(" ")).toContain("posts:read");
});

it("exports the actual registered schemas for every entitlement profile without executing tools", async () => {
  const profiles = [
    { name: "base", extensions: false, fitting: false },
    { name: "base-with-fitting", extensions: false, fitting: true },
    { name: "extensions", extensions: true, fitting: false },
    { name: "extensions-and-fitting", extensions: true, fitting: true },
  ].map((profile) => ({
    profile: profile.name,
    tools: register(DEFAULT_MCP_SCOPE, profile.extensions, profile.fitting).map(([, name, config]) => ({
      name,
      title: config.title,
      description: config.description,
      inputSchema: jsonSchema(config.inputSchema, "input"),
      outputSchema: jsonSchema(config.outputSchema, "output"),
      annotations: config.annotations,
      museReview: {
        ...reviews[name],
        approval: reviews[name].class === "sensitive_write" ? "ask_every_use" : "ask_first_use",
      },
    })),
  }));
  expect(profiles[0].tools).toHaveLength(12);
  expect(profiles[1].tools).toHaveLength(12);
  expect(profiles[2].tools).toHaveLength(23);
  expect(profiles[3].tools).toHaveLength(23);
  for (const profile of profiles) {
    const validation = profile.tools.find((tool) => tool.name === "validate_post")!;
    expect(Object.hasOwn(validation.inputSchema!.properties!, "imageFit")).toBe(profile.profile.includes("fitting"));
  }
  // Only the explicit preparation command writes a generated review artifact.
  // Ordinary unit tests have no filesystem output or remote side effects.
  const output = process.env.SIMPLEPOST_MUSE_EXPORT_DIR;
  if (output) {
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, "tool-contracts.json"), `${JSON.stringify(profiles, null, 2)}\n`, { flag: "wx" });
  }
});
