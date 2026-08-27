import { defineRoute, jsonResponse, mcpAuthSecurity, userAuthErrorResponses } from "@/lib/openapi/helpers";
import { OidcUserInfoSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/oauth/userinfo",
  methods: {
    get: {
      operationId: "getMcpOidcUserInfo",
      tags: ["OAuth"],
      summary: "Return OpenID Connect user claims",
      security: mcpAuthSecurity,
      responses: {
        "200": jsonResponse("OpenID Connect user claims.", OidcUserInfoSchema),
        ...userAuthErrorResponses,
      },
    },
  },
});
