import * as z from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";

const response = z
  .object({
    accounts: z.array(
      z.object({
        accountId: z.string(),
        platform: z.string(),
        processed: z.number().int().nonnegative(),
        mentionsProcessed: z.boolean().optional(),
        hasMore: z.boolean(),
        coverage: z.string().optional(),
        error: z.string().optional(),
      }),
    ),
    hasMore: z.boolean(),
  })
  .meta({ id: "SocialRefreshResponse" });
export default defineRoute({
  path: "/api/v1/social/inbox/refresh",
  methods: {
    post: {
      operationId: "refreshSocialInbox",
      tags: ["Social"],
      summary: "Advance the bounded, resumable social inbox sync",
      description:
        "Refreshes a small number of owned SimplePost targets per account and optionally account mentions. Repeated calls continue older targets; provider failures retain prior cached activity.",
      security: userAuthSecurity,
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: z.object({ includeMentions: z.boolean().optional(), reset: z.boolean().optional() }),
          },
        },
      },
      responses: {
        "200": jsonResponse("Per-account continuation status.", response),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
