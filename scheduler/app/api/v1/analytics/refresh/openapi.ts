import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { AnalyticsRefreshResponseSchema, analyticsRefreshRequestSchema } from "@/lib/post-analytics/schemas";

export default defineRoute({
  path: "/api/v1/analytics/refresh",
  methods: {
    post: {
      operationId: "refreshAnalytics",
      tags: ["Analytics"],
      summary: "Refresh analytics from the platforms",
      description:
        "Reads stale analytics from the social platforms for recent posts (default: last 90 days), a period, or specific posts, and updates follower counts. The call is time-bounded; when posts.skipped is greater than zero, call it again to continue.",
      security: userAuthSecurity,
      requestBody: {
        required: false,
        content: { "application/json": { schema: analyticsRefreshRequestSchema } },
      },
      responses: {
        "200": jsonResponse("Refresh outcome.", AnalyticsRefreshResponseSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
