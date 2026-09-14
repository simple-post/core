import * as z from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { SocialInboxEnvelopeSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/social/inbox",
  methods: {
    get: {
      operationId: "getSocialInbox",
      tags: ["Social"],
      summary: "List cached comments and account mentions",
      security: userAuthSecurity,
      requestParams: {
        query: z.object({
          kind: z.enum(["comment", "mention"]).optional(),
          platform: z.string().max(40).optional(),
          accountId: z.string().max(100).optional(),
          cursor: z.string().max(500).optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
        }),
      },
      responses: {
        "200": jsonResponse("A cursor-paginated social activity page.", SocialInboxEnvelopeSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
