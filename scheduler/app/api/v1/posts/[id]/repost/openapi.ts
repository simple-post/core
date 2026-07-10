import * as z from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { ManualRepostPostRequestSchema, RepostPostResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/posts/{id}/repost",
  methods: {
    post: {
      operationId: "repostPost",
      tags: ["Posts"],
      summary: "Repost a published post",
      description:
        "Reposts the authenticated user's previously published SimplePost post on platforms that support native reposts.",
      security: userAuthSecurity,
      requestParams: {
        path: z.object({
          id: z.string().meta({ description: "Post ID." }),
        }),
      },
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: ManualRepostPostRequestSchema,
          },
        },
      },
      responses: {
        "200": jsonResponse("Repost attempt results.", RepostPostResponseSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
