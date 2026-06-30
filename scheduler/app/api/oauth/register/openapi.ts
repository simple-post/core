import { defineRoute, jsonResponse, serverErrorResponses } from "@/lib/openapi/helpers";
import { OAuthErrorSchema, OAuthRegisterRequestSchema, OAuthRegisterResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/oauth/register",
  methods: {
    post: {
      operationId: "registerMcpOAuthClient",
      tags: ["OAuth"],
      summary: "Register an MCP OAuth client",
      description: "Dynamic Client Registration endpoint used by MCP clients before starting authorization.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: OAuthRegisterRequestSchema,
          },
        },
      },
      responses: {
        "201": jsonResponse("Registered OAuth client metadata.", OAuthRegisterResponseSchema),
        "400": jsonResponse("Invalid client metadata.", OAuthErrorSchema),
        ...serverErrorResponses,
      },
    },
  },
});
