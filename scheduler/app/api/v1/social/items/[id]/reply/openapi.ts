import * as z from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { inboxReplyReceiptSchema, inboxReplySchema, inboxItemIdSchema } from "@/lib/social/schemas";

export default defineRoute({
  path: "/api/v1/social/items/{id}/reply",
  methods: {
    post: {
      operationId: "replyToInboxItem",
      tags: ["Social inbox"],
      summary: "Reply as the connected account",
      security: userAuthSecurity,
      requestParams: { path: z.object({ id: inboxItemIdSchema }) },
      requestBody: { required: true, content: { "application/json": { schema: inboxReplySchema } } },
      responses: {
        "200": jsonResponse("Reply as the connected account.", inboxReplyReceiptSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
