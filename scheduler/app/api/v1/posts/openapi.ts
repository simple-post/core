import * as z from "zod/v4";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import {
  CreatePostRequestSchema,
  CreatePostResponseSchema,
  PostCountsEnvelopeSchema,
  PostsEnvelopeSchema,
} from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/posts",
  methods: {
    get: {
      operationId: "listPosts",
      tags: ["Posts"],
      summary: "List posts",
      description: "Lists drafts, scheduled, past, failed, or all posts for the authenticated user.",
      security: userAuthSecurity,
      requestParams: {
        query: z.object({
          type: z.enum(["all", "drafts", "scheduled", "past", "failed", "counts"]).optional().default("all"),
          page: z.coerce.number().int().positive().optional().default(1),
          limit: z.coerce.number().int().positive().max(100).optional().default(25),
        }),
      },
      responses: {
        "200": jsonResponse(
          "Posts matching the requested filter, or counts when type=counts.",
          z.union([PostsEnvelopeSchema, PostCountsEnvelopeSchema]),
        ),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
    post: {
      operationId: "createPost",
      tags: ["Posts"],
      summary: "Create, publish, or schedule a post",
      security: userAuthSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: CreatePostRequestSchema,
          },
        },
      },
      responses: {
        "201": jsonResponse("Created post and optional immediate publishing results.", CreatePostResponseSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
