import * as z from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { ApiErrorSchema, CreatePostResponseSchema } from "@/lib/openapi/schemas";
import { createPabblyPostFormSchema } from "@/lib/validations/pabbly-posts";

export default defineRoute({
  path: "/api/v1/integrations/pabbly/posts",
  methods: {
    post: {
      operationId: "createPabblyPost",
      tags: ["Posts"],
      summary: "Create a draft or scheduled post from Pabbly Connect",
      security: userAuthSecurity,
      requestBody: {
        required: true,
        content: {
          "application/x-www-form-urlencoded": {
            schema: createPabblyPostFormSchema,
          },
        },
      },
      responses: {
        "200": jsonResponse(
          "Original post returned for a previously used idempotency key.",
          CreatePostResponseSchema.pick({ warnings: true }).extend({
            post: CreatePostResponseSchema.shape.post.nullable(),
            replayed: z.literal(true),
          }),
        ),
        "201": jsonResponse("Draft or scheduled post created.", CreatePostResponseSchema),
        "415": jsonResponse("A URL-encoded form body is required.", ApiErrorSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
