import {
  basicErrorResponses,
  browserSessionSecurity,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
} from "@/lib/openapi/helpers";
import { CliAuthorizeRequestSchema, RedirectUrlResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/cli/authorize",
  methods: {
    post: {
      operationId: "authorizeCli",
      tags: ["CLI"],
      summary: "Authorize a local CLI session",
      description:
        "Creates a short-lived one-time code for an authenticated browser user and returns a loopback redirect URL. The CLI exchanges the code for a bearer token outside the browser.",
      security: browserSessionSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: CliAuthorizeRequestSchema,
          },
        },
      },
      responses: {
        "200": jsonResponse("Redirect URL containing the one-time CLI authorization code.", RedirectUrlResponseSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
