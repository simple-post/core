import * as z from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { AnalyticsPostsEnvelopeSchema, analyticsPostsQuerySchema } from "@/lib/post-analytics/schemas";

export default defineRoute({
  path: "/api/v1/analytics/posts",
  methods: {
    get: {
      operationId: "listPostAnalytics",
      tags: ["Analytics"],
      summary: "List posts with analytics",
      description:
        "Paginated posts with their combined metrics for a period, sortable by any metric (views, likes, engagements, engagementRate, …).",
      security: userAuthSecurity,
      requestParams: {
        query: analyticsPostsQuerySchema.extend({ platform: z.string().optional(), accountId: z.string().optional() }),
      },
      responses: {
        "200": jsonResponse("Posts with analytics.", AnalyticsPostsEnvelopeSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
