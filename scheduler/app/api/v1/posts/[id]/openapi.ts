import * as z from "zod/v4";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { PostEnvelopeSchema, SuccessSchema, UpdatePostRequestSchema } from "@/lib/openapi/schemas";

const requestParams = {
  path: z.object({
    id: z.string().meta({ description: "Post ID." }),
  }),
};

export default defineRoute({
  path: "/api/v1/posts/{id}",
  methods: {
    get: {
      operationId: "getPost",
      tags: ["Posts"],
      summary: "Get a post",
      security: userAuthSecurity,
      requestParams,
      responses: {
        "200": jsonResponse("Post details.", PostEnvelopeSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
    patch: {
      operationId: "updatePost",
      tags: ["Posts"],
      summary: "Update a scheduled post",
      security: userAuthSecurity,
      requestParams,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: UpdatePostRequestSchema,
          },
        },
      },
      responses: {
        "200": jsonResponse("Updated post details.", PostEnvelopeSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
    delete: {
      operationId: "deletePost",
      tags: ["Posts"],
      summary: "Delete a post",
      security: userAuthSecurity,
      requestParams,
      responses: {
        "200": jsonResponse("Post deleted.", SuccessSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
