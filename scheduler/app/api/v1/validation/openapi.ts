import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { ValidationRequestSchema, ValidationResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/validation",
  methods: {
    post: {
      operationId: "validatePost",
      tags: ["Validation"],
      summary: "Validate a draft post against selected accounts",
      security: userAuthSecurity,
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
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
