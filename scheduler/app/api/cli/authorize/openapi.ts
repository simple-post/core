import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { CliAuthorizeRequestSchema, RedirectUrlResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/cli/authorize",
  methods: {
    post: {
      operationId: "authorizeCli",
      tags: ["CLI"],
      summary: "Authorize a local CLI session",
      description: "Creates a CLI bearer token for an authenticated browser user and returns a loopback redirect URL.",
      security: userAuthSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: CliAuthorizeRequestSchema,
          },
        },
      },
      responses: {
        "200": jsonResponse("Redirect URL containing the issued CLI token.", RedirectUrlResponseSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
