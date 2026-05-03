import { defineRoute, jsonResponse, serverErrorResponses } from "@/lib/openapi/helpers";
import { OAuthErrorSchema, OAuthTokenRequestSchema, OAuthTokenResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/oauth/token",
  methods: {
    post: {
      operationId: "exchangeMcpOAuthCode",
      tags: ["OAuth"],
      summary: "Exchange an MCP OAuth authorization code for a token",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: OAuthTokenRequestSchema,
          },
          "application/x-www-form-urlencoded": {
            schema: OAuthTokenRequestSchema,
          },
        },
      },
      responses: {
        "200": jsonResponse("OAuth access token.", OAuthTokenResponseSchema),
        "400": jsonResponse("OAuth token request was invalid.", OAuthErrorSchema),
        "401": jsonResponse("OAuth client authentication failed.", OAuthErrorSchema),
        ...serverErrorResponses,
      },
    },
  },
});
