import * as z from "zod";

import {
  apiKeyErrorResponses,
  apiKeySecurity,
  basicErrorResponses,
  defineRoute,
  jsonResponse,
} from "../openapi/helpers.js";
import {
  AnalyticsAccountsResponseSchema,
  AnalyticsPostsRequestSchema,
  AnalyticsPostsResponseSchema,
} from "../openapi/schemas.js";

export const analyticsPostsRoute = defineRoute({
  path: "/api/v1/analytics/posts",
  methods: {
    post: {
      operationId: "getPostAnalytics",
      tags: ["Analytics"],
      summary: "Read post analytics",
      description:
        "Reads views, likes, comments, shares and other metrics for posts published through configured accounts. Every target gets a status; platforms report different metrics.",
      security: apiKeySecurity,
      requestBody: { required: true, content: { "application/json": { schema: AnalyticsPostsRequestSchema } } },
      responses: {
        "200": jsonResponse("Per-target analytics.", AnalyticsPostsResponseSchema),
        ...apiKeyErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});

export const analyticsAccountsRoute = defineRoute({
  path: "/api/v1/analytics/accounts",
  methods: {
    get: {
      operationId: "getAccountAnalytics",
      tags: ["Analytics"],
      summary: "Read account analytics",
      description: "Reads followers and other account-level analytics for configured accounts.",
      security: apiKeySecurity,
      requestParams: {
        query: z.object({
          accountId: z.string().optional().meta({ description: "Comma-separated account IDs (default: all)." }),
        }),
      },
      responses: {
        "200": jsonResponse("Account analytics.", AnalyticsAccountsResponseSchema),
        ...apiKeyErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
