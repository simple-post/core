import { z } from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { reconciliationSchema } from "@/lib/posting/reconciliation";

const requestParams = { path: z.object({ id: z.string() }) };
export default defineRoute({
  path: "/api/v1/posts/{id}/reconcile",
  methods: {
    get: {
      operationId: "getPostPublishingProgress",
      tags: ["Posts"],
      summary: "Inspect durable publishing progress",
      security: userAuthSecurity,
      requestParams,
      responses: {
        "200": jsonResponse(
          "Per-account and per-segment publishing records.",
          z.object({
            checkpoints: z.array(
              z.object({
                accountId: z.string(),
                operation: z.string(),
                segment: z.number(),
                state: z.string(),
                updatedAt: z.iso.datetime(),
                result: z.unknown(),
              }),
            ),
          }),
        ),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
    post: {
      operationId: "reconcilePostPublishingProgress",
      tags: ["Posts"],
      summary: "Confirm an uncertain publishing outcome",
      description:
        "After checking the platform and ensuring the old worker has stopped, explicitly confirm whether this operation published. Use updatedAt from GET. A published Bluesky result requires its URI and CID. This records the result; retry the existing post afterward to resume remaining segments.",
      security: userAuthSecurity,
      requestParams,
      requestBody: { required: true, content: { "application/json": { schema: reconciliationSchema } } },
      responses: {
        "200": jsonResponse("Outcome recorded.", z.object({ success: z.literal(true) })),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
