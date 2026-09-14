import * as z from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { SocialReplyEnvelopeSchema, SocialReplyRequestSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/social/items/{id}/reply",
  methods: {
    post: {
      operationId: "replyToSocialActivity",
      tags: ["Social"],
      summary: "Reply as the owning connected account",
      description:
        "The reply target is resolved from cached, authenticated owned activity. An idempotency key prevents duplicate successful retries.",
      security: userAuthSecurity,
      requestParams: { path: z.object({ id: z.string() }) },
      requestBody: { required: true, content: { "application/json": { schema: SocialReplyRequestSchema } } },
      responses: {
        "200": jsonResponse("Provider reply result.", SocialReplyEnvelopeSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
