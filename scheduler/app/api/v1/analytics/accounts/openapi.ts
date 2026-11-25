import * as z from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { AccountAnalyticsEnvelopeSchema, AnalyticsRefreshModeSchema } from "@/lib/post-analytics/schemas";

export default defineRoute({
  path: "/api/v1/analytics/accounts",
  methods: {
    get: {
      operationId: "listAccountAnalytics",
      tags: ["Analytics"],
      summary: "Get account analytics",
      description:
        "Latest account-level analytics (followers, following, posts, total views/likes) for every connected account, plus which metrics each platform supports and whether reconnecting would unlock more analytics.",
      security: userAuthSecurity,
      requestParams: { query: z.object({ refresh: AnalyticsRefreshModeSchema.optional() }) },
      responses: {
        "200": jsonResponse("Account analytics.", AccountAnalyticsEnvelopeSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
