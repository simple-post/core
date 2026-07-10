import { defineRoute, emptyResponse, jsonResponse, serverErrorResponses } from "@/lib/openapi/helpers";
import { CliTokenExchangeRequestSchema, CliTokenResponseSchema, OAuthErrorSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/cli/token",
  methods: {
    post: {
      operationId: "exchangeCliAuthorizationCode",
      tags: ["CLI"],
      summary: "Exchange a one-time CLI authorization code",
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: CliTokenExchangeRequestSchema },
          "application/x-www-form-urlencoded": { schema: CliTokenExchangeRequestSchema },
        },
      },
      responses: {
        "200": jsonResponse("CLI bearer token and authenticated user.", CliTokenResponseSchema),
        "400": jsonResponse("CLI token request was invalid.", OAuthErrorSchema),
        ...serverErrorResponses,
      },
    },
    delete: {
      operationId: "revokeCliToken",
      tags: ["CLI"],
      summary: "Revoke the current CLI bearer token",
      security: [{ cliBearerAuth: [] }],
      responses: {
        "204": emptyResponse("CLI token revoked."),
        "401": jsonResponse("CLI token was missing or invalid.", OAuthErrorSchema),
        ...serverErrorResponses,
      },
    },
  },
});
