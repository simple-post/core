import * as z from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { inboxPageSchema, inboxQuerySchema } from "@/lib/social/schemas";

export default defineRoute({
  path: "/api/v1/social/inbox",
  methods: {
    get: {
      operationId: "getSocialInbox",
      tags: ["Social inbox"],
      summary: "List cached replies, comments, and quote posts",
      security: userAuthSecurity,
      requestParams: { query: inboxQuerySchema.extend({ limit: z.coerce.number().int().min(1).max(100).optional() }) },
      responses: {
        "200": jsonResponse("List cached replies, comments, and quote posts.", inboxPageSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
