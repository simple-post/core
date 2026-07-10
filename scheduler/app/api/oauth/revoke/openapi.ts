import { defineRoute, emptyResponse, jsonResponse, serverErrorResponses } from "@/lib/openapi/helpers";
import { OAuthErrorSchema, OAuthRevokeRequestSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/oauth/revoke",
  methods: {
    post: {
      operationId: "revokeMcpOAuthToken",
      tags: ["OAuth"],
      summary: "Revoke an MCP OAuth access token",
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: OAuthRevokeRequestSchema },
          "application/x-www-form-urlencoded": { schema: OAuthRevokeRequestSchema },
        },
      },
      responses: {
        "200": emptyResponse("Token revoked or already inactive."),
        "400": jsonResponse("OAuth revocation request was invalid.", OAuthErrorSchema),
        "401": jsonResponse("OAuth client authentication failed.", OAuthErrorSchema),
        ...serverErrorResponses,
      },
    },
  },
});
