import { basicErrorResponses, defineRoute, jsonResponse, scheduledDispatchSecurity } from "@/lib/openapi/helpers";
import { ApiErrorSchema, DispatchScheduledPostsResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/internal/scheduled-posts/dispatch",
  methods: {
    post: {
      operationId: "dispatchDueScheduledPosts",
      tags: ["Internal"],
      summary: "Dispatch due scheduled posts",
      description: "Trusted infrastructure endpoint for cron or worker processes.",
      security: scheduledDispatchSecurity,
      responses: {
        "200": jsonResponse("Dispatch result summary.", DispatchScheduledPostsResponseSchema),
        "401": jsonResponse("Invalid dispatch bearer token.", ApiErrorSchema),
        ...basicErrorResponses,
      },
    },
  },
});
