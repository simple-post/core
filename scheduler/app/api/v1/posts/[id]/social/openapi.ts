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
  path: "/api/v1/posts/{id}/social",
  methods: {
    get: {
      operationId: "getPostSocialActivity",
      tags: ["Social"],
      summary: "Get cached analytics and comments for a SimplePost-published post",
      security: userAuthSecurity,
      requestParams: { path: z.object({ id: z.string() }) },
      responses: {
        "200": jsonResponse(
          "Platform-specific metric snapshots and cached comments.",
          SocialPostActivityEnvelopeSchema,
        ),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
