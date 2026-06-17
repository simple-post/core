import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";

import { listAccountsSchema } from "@/lib/mcp/tools/accounts";
import { uploadMediaSchema } from "@/lib/mcp/tools/media";
import {
  createPostSchema,
  discardScheduledPostSchema,
  inspectPostsSchema,
  previewPostSchema,
  updateScheduledPostSchema,
} from "@/lib/mcp/tools/posts";
import { validatePostSchema } from "@/lib/mcp/tools/validation";

import type { AnySchema, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";

type JsonSchemaObject = {
  anyOf?: JsonSchemaObject[];
  enum?: string[];
  items?: JsonSchemaObject;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  $ref?: string;
  type?: string;
};

const TOOL_INPUT_SCHEMAS = {
  list_accounts: listAccountsSchema,
  upload_media: uploadMediaSchema,
  validate_post: validatePostSchema,
  preview_post: previewPostSchema,
  create_post: createPostSchema,
  inspect_posts: inspectPostsSchema,
  update_scheduled_post: updateScheduledPostSchema,
  discard_scheduled_post: discardScheduledPostSchema,
};

const THREAD_INPUT_SCHEMAS = {
  validate_post: validatePostSchema,
  preview_post: previewPostSchema,
  create_post: createPostSchema,
  update_scheduled_post: updateScheduledPostSchema,
};

function toInputJsonSchema(schema: { shape: unknown }): JsonSchemaObject {
  const objectSchema = normalizeObjectSchema(schema.shape as AnySchema | ZodRawShapeCompat | undefined);
  if (!objectSchema) return { type: "object", properties: {} };

  return toJsonSchemaCompat(objectSchema, {
    strictUnions: true,
    pipeStrategy: "input",
  }) as JsonSchemaObject;
}

function findArraySchema(schema: JsonSchemaObject): JsonSchemaObject {
  if (schema.type === "array") return schema;
  const nestedArray = schema.anyOf
    ?.map((candidate) => {
      try {
        return findArraySchema(candidate);
      } catch {
        return undefined;
      }
    })
    .find((candidate) => candidate?.type === "array");
  if (!nestedArray) throw new Error("Expected an array schema");
  return nestedArray;
}

function collectOpaqueArrays(schema: JsonSchemaObject, path: string, issues: string[]): void {
  if (schema.type === "array") {
    if (!schema.items) {
      issues.push(`${path}: array without items`);
    } else if (schema.items.$ref) {
      issues.push(`${path}: array items use $ref ${schema.items.$ref}`);
    }
  }

  if (schema.anyOf) {
    schema.anyOf.forEach((child, index) => collectOpaqueArrays(child, `${path}.anyOf[${index}]`, issues));
  }

  if (schema.items) {
    collectOpaqueArrays(schema.items, `${path}[]`, issues);
  }

  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    collectOpaqueArrays(child, `${path}.${key}`, issues);
  }
}

function assertThreadMediaItems(schema: JsonSchemaObject): void {
  const threadSchema = schema.properties?.thread;
  expect(threadSchema).toBeDefined();

  const threadArray = findArraySchema(threadSchema!);
  const segmentSchema = threadArray.items;
  const mediaSchema = segmentSchema?.properties?.media;
  expect(mediaSchema).toBeDefined();

  const mediaArray = findArraySchema(mediaSchema!);
  const mediaItem = mediaArray.items;
  expect(mediaItem?.type).toBe("object");
  expect(mediaItem?.required).toEqual(expect.arrayContaining(["type", "url"]));
  expect(mediaItem?.properties?.type.enum).toEqual(["image", "video"]);
  expect(mediaItem?.properties?.url.type).toBe("string");
}

describe("MCP tool JSON schemas", () => {
  it("does not expose opaque array arguments", () => {
    const issues: string[] = [];

    for (const [toolName, schema] of Object.entries(TOOL_INPUT_SCHEMAS)) {
      collectOpaqueArrays(toInputJsonSchema(schema), toolName, issues);
    }

    expect(issues).toEqual([]);
  });

  it("describes thread segment media items wherever thread input is accepted", () => {
    for (const schema of Object.values(THREAD_INPUT_SCHEMAS)) {
      assertThreadMediaItems(toInputJsonSchema(schema));
    }
  });
});
