import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { inboxRefreshResultSchema, inboxRefreshSchema } from "@/lib/social/schemas";

export default defineRoute({
  path: "/api/v1/social/inbox/refresh",
  methods: {
    post: {
      operationId: "refreshSocialInbox",
      tags: ["Social inbox"],
      summary: "Advance a bounded inbox refresh",
      security: userAuthSecurity,
      requestBody: { required: true, content: { "application/json": { schema: inboxRefreshSchema } } },
      responses: {
        "200": jsonResponse("Advance a bounded inbox refresh.", inboxRefreshResultSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
