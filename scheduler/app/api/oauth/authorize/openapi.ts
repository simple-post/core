import {
  defineRoute,
  jsonResponse,
  serverErrorResponses,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { OAuthAuthorizeRequestSchema, OAuthErrorSchema, RedirectUrlResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/oauth/authorize",
  methods: {
    post: {
      operationId: "authorizeMcpOAuthClient",
      tags: ["OAuth"],
      summary: "Authorize an MCP OAuth client",
      description: "Processes the consent form and returns the client redirect URL with an authorization code.",
      security: userAuthSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: OAuthAuthorizeRequestSchema,
          },
        },
      },
      responses: {
        "200": jsonResponse("Redirect URL containing the OAuth authorization code.", RedirectUrlResponseSchema),
        "400": jsonResponse("OAuth authorization request was invalid.", OAuthErrorSchema),
        ...userAuthErrorResponses,
        ...serverErrorResponses,
      },
    },
  },
});
