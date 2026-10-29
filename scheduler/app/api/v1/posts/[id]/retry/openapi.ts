import { z } from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";

export default defineRoute({
  path: "/api/v1/posts/{id}/retry",
  methods: {
    post: {
      operationId: "scheduleTikTokPostRetry",
      tags: ["Posts"],
      summary: "Schedule another attempt for a recoverable TikTok failure",
      description:
        "Changes only the retry time on the original post. Preserves successful destinations and durable publishing progress. Uncertain outcomes require reconciliation. Inbox mode schedules delivery to TikTok, where the user still finishes publishing; acceptance is not guaranteed.",
      security: userAuthSecurity,
      requestParams: { path: z.object({ id: z.string() }) },
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: z.object({
              scheduledFor: z.iso.datetime({ offset: true }),
              expectedUpdatedAt: z.iso.datetime().optional(),
            }),
          },
        },
      },
      responses: {
        "200": jsonResponse(
          "Original post scheduled for another attempt.",
          z.object({ post: z.unknown(), message: z.string() }),
        ),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
