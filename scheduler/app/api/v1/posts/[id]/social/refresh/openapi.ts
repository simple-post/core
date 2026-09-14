import * as z from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { SocialPostActivityEnvelopeSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/posts/{id}/social/refresh",
  methods: {
    post: {
      operationId: "refreshPostSocialActivity",
      tags: ["Social"],
      summary: "Refresh analytics and comments for one SimplePost post",
      security: userAuthSecurity,
      requestParams: { path: z.object({ id: z.string() }) },
      requestBody: {
        required: false,
        content: { "application/json": { schema: z.object({ reset: z.boolean().optional() }) } },
      },
      responses: {
        "200": jsonResponse(
          "Updated activity snapshot; provider failures retain cached values. Send reset=true for newer comments; omit it to continue a provider comment page.",
          SocialPostActivityEnvelopeSchema,
        ),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
