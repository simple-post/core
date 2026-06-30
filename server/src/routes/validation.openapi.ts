import {
  apiKeyErrorResponses,
  apiKeySecurity,
  basicErrorResponses,
  defineRoute,
  jsonResponse,
} from "../openapi/helpers.js";
import { ValidationRequestSchema, ValidationResponseSchema } from "../openapi/schemas.js";

export default defineRoute({
  path: "/api/v1/validation",
  methods: {
    post: {
      operationId: "validatePost",
      tags: ["Validation"],
      summary: "Validate a draft post against configured accounts",
      security: apiKeySecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: ValidationRequestSchema,
          },
        },
      },
      responses: {
        "200": jsonResponse("Validation result grouped by account/platform.", ValidationResponseSchema),
        ...apiKeyErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
