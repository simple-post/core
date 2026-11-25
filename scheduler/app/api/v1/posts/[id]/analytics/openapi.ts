import * as z from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { AnalyticsRefreshModeSchema, PostAnalyticsEnvelopeSchema } from "@/lib/post-analytics/schemas";

export default defineRoute({
  path: "/api/v1/posts/{id}/analytics",
  methods: {
    get: {
      operationId: "getPostAnalytics",
      tags: ["Analytics"],
      summary: "Get analytics for a post",
      description:
        "Returns views, likes, comments, shares and other metrics for every account the post was published to, with platform-native metrics and the post's metric history. Values are cached; by default stale values are refreshed from the platforms first (refresh=auto). Use refresh=none for cached values only.",
      security: userAuthSecurity,
      requestParams: {
        path: z.object({ id: z.string().meta({ description: "Post ID." }) }),
        query: z.object({ refresh: AnalyticsRefreshModeSchema.optional() }),
      },
      responses: {
        "200": jsonResponse("Post analytics.", PostAnalyticsEnvelopeSchema),
        "404": jsonResponse("Post not found.", z.object({ error: z.string() })),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
