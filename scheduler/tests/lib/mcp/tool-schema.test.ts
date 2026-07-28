import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";

import { listAccountsOutputSchema, listAccountsSchema } from "@/lib/mcp/tools/accounts";
import { uploadMediaSchema } from "@/lib/mcp/tools/media";
import { toMediaFiles } from "@/lib/mcp/tools/media-schema";
import {
  createPostSchema,
  discardScheduledPostSchema,
  inspectPostsSchema,
  previewPostOutputSchema,
  previewPostSchema,
  updateScheduledPostSchema,
} from "@/lib/mcp/tools/posts";
import { validatePostOutputSchema, validatePostSchema } from "@/lib/mcp/tools/validation";

import type { AnySchema, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";

type JsonSchemaObject = {
  anyOf?: JsonSchemaObject[];
  enum?: string[];
  items?: JsonSchemaObject;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  $ref?: string;
  type?: string | string[];
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

const ROOT_MEDIA_INPUT_SCHEMAS = {
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
  if (schema.type === "array" || (Array.isArray(schema.type) && schema.type.includes("array"))) return schema;
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

function assertMediaItems(schema: JsonSchemaObject): void {
  const mediaArray = findArraySchema(schema);
  const mediaItem = mediaArray.items;
  expect(mediaItem?.type).toBe("object");
  expect(mediaItem?.required).toEqual(expect.arrayContaining(["type", "url"]));
  expect(mediaItem?.properties?.type.enum).toEqual(["image", "video"]);
  expect(mediaItem?.properties?.url.type).toBe("string");
  expect(mediaItem?.properties?.filename?.type).toBe("string");
  expect(mediaItem?.properties?.size?.type).toBe("integer");
}

function assertTextOnlyThreadSegments(schema: JsonSchemaObject): void {
  const threadSchema = schema.properties?.thread;
  expect(threadSchema).toBeDefined();

  const threadArray = findArraySchema(threadSchema!);
  const segmentSchema = threadArray.items;
  expect(segmentSchema?.type).toBe("object");
  expect(segmentSchema?.required).toEqual(expect.arrayContaining(["message"]));
  expect(segmentSchema?.properties?.message?.type).toBe("string");
  expect(segmentSchema?.properties?.media).toBeUndefined();
}

describe("MCP tool JSON schemas", () => {
  it("does not expose opaque array arguments", () => {
    const issues: string[] = [];

    for (const [toolName, schema] of Object.entries(TOOL_INPUT_SCHEMAS)) {
      collectOpaqueArrays(toInputJsonSchema(schema), toolName, issues);
    }

    expect(issues).toEqual([]);
  });

  it("describes root media items wherever root media input is accepted", () => {
    for (const schema of Object.values(ROOT_MEDIA_INPUT_SCHEMAS)) {
      const mediaSchema = toInputJsonSchema(schema).properties?.media;
      expect(mediaSchema).toBeDefined();
      assertMediaItems(mediaSchema!);
    }
  });

  it("keeps thread segment inputs text-only to avoid nested opaque media arrays", () => {
    for (const schema of Object.values(THREAD_INPUT_SCHEMAS)) {
      assertTextOnlyThreadSegments(toInputJsonSchema(schema));
    }
  });

  it("preserves upload metadata for platform file-size validation", () => {
    expect(
      toMediaFiles([
        {
          type: "image",
          url: "https://files.simplepost.social/uploads/user/image.png",
          filename: "image.png",
          size: 8_450_653,
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        type: "image",
        filename: "image.png",
        size: 8_450_653,
      }),
    ]);
  });

  it("exposes SimplePost quote references on create, preview, and scheduled updates", () => {
    expect(toInputJsonSchema(createPostSchema).properties?.quotePostId?.type).toBe("string");
    expect(toInputJsonSchema(previewPostSchema).properties?.quotePostId?.type).toBe("string");
    expect(toInputJsonSchema(updateScheduledPostSchema).properties?.quotePostId).toBeDefined();
  });

  it("accepts the account identity returned by validation and preview tools", () => {
    const account = {
      accountId: "account-1",
      platform: "x",
      username: "clompton",
      displayName: "Clompton",
      profilePicture: null,
    };
    const validation = {
      kind: "validation" as const,
      message: "Shipping the new release notes today.",
      mediaCount: 0,
      isValid: true,
      platforms: ["x"],
      accounts: [
        {
          ...account,
          isValid: true,
          errors: [],
          warnings: [],
        },
      ],
      summary: {
        accountCount: 1,
        mediaCount: 0,
        errorCount: 0,
        warningCount: 0,
      },
    };
    const preview = {
      kind: "preview" as const,
      message: validation.message,
      postingMode: "now" as const,
      scheduledFor: null,
      quotePostId: null,
      mediaCount: 0,
      accounts: [account],
      validation,
      summary: {
        accountCount: 1,
        mediaCount: 0,
        threadSegmentCount: 0,
        errorCount: 0,
        warningCount: 0,
      },
    };

    expect(validatePostOutputSchema.parse(validation)).toEqual(validation);
    expect(previewPostOutputSchema.parse(preview)).toEqual(preview);
  });

  it("continues to require credential health in list_accounts output", () => {
    const result = listAccountsOutputSchema.safeParse({
      kind: "accounts",
      accounts: [
        {
          accountId: "account-1",
          platform: "x",
          username: "clompton",
          displayName: "Clompton",
          profilePicture: null,
        },
      ],
      summary: {
        total: 1,
        platforms: ["x"],
      },
    });

    expect(result.success).toBe(false);
  });
});
