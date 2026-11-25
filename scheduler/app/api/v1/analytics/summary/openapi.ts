import * as z from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { AnalyticsSummaryEnvelopeSchema, analyticsSummaryQuerySchema } from "@/lib/post-analytics/schemas";

export default defineRoute({
  path: "/api/v1/analytics/summary",
  methods: {
    get: {
      operationId: "getAnalyticsSummary",
      tags: ["Analytics"],
      summary: "Get an analytics summary",
      description:
        "Totals, comparison with the previous period, per-platform and per-account breakdowns, a timeline, top posts, best publishing times and follower growth for a period (last 24 hours, week, month, year, custom, …). Cached values are used unless refresh=auto or refresh=force.",
      security: userAuthSecurity,
      requestParams: {
        query: analyticsSummaryQuerySchema.extend({
          platform: z.string().optional(),
          accountId: z.string().optional(),
        }),
      },
      responses: {
        "200": jsonResponse("Analytics summary.", AnalyticsSummaryEnvelopeSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
