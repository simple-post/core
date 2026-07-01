import {
  apiKeyErrorResponses,
  apiKeySecurity,
  basicErrorResponses,
  defineRoute,
  jsonResponse,
} from "../openapi/helpers.js";
import { RepostRequestSchema, RepostResponseSchema } from "../openapi/schemas.js";

export default defineRoute({
  path: "/api/v1/reposts",
  methods: {
    post: {
      operationId: "repost",
      tags: ["Posts"],
      summary: "Repost existing content",
      description:
        "Reposts or reshares an existing platform post through configured accounts that support native reposting.",
      security: apiKeySecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: RepostRequestSchema,
          },
        },
      },
      responses: {
        "200": jsonResponse("Per-account repost results.", RepostResponseSchema),
        ...apiKeyErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
