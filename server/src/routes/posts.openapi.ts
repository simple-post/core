import {
  apiKeyErrorResponses,
  apiKeySecurity,
  basicErrorResponses,
  defineRoute,
  jsonResponse,
} from "../openapi/helpers.js";
import { CreatePostRequestSchema, CreatePostResponseSchema } from "../openapi/schemas.js";

export default defineRoute({
  path: "/api/v1/posts",
  methods: {
    post: {
      operationId: "createPost",
      tags: ["Posts"],
      summary: "Publish a post immediately",
      description:
        "Publishes through configured accounts. The self-hosted server only supports postingMode: now; use the Scheduler app for scheduling.",
      security: apiKeySecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: CreatePostRequestSchema,
          },
        },
      },
      responses: {
        "201": jsonResponse("Published post record and per-account posting results.", CreatePostResponseSchema),
        ...apiKeyErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
