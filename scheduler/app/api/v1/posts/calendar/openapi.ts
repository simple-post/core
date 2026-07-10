import * as z from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { PostsEnvelopeSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/posts/calendar",
  methods: {
    get: {
      operationId: "listCalendarPosts",
      tags: ["Posts"],
      summary: "List posts for a calendar range",
      description:
        "Returns non-draft posts scheduled between from (inclusive) and to (exclusive) without pagination. The range must be at most 62 days.",
      security: userAuthSecurity,
      requestParams: {
        query: z.object({
          from: z.iso.datetime({ offset: true }),
          to: z.iso.datetime({ offset: true }),
        }),
      },
      responses: {
        "200": jsonResponse("Posts scheduled inside the requested range.", PostsEnvelopeSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
