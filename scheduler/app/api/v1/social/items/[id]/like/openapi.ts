import * as z from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { inboxLikeReceiptSchema, inboxItemIdSchema } from "@/lib/social/schemas";

export default defineRoute({
  path: "/api/v1/social/items/{id}/like",
  methods: {
    put: {
      operationId: "likeInboxItem",
      tags: ["Social inbox"],
      summary: "Ensure the connected account likes the item",
      security: userAuthSecurity,
      requestParams: { path: z.object({ id: inboxItemIdSchema }) },
      responses: {
        "200": jsonResponse("Ensure the connected account likes the item.", inboxLikeReceiptSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
