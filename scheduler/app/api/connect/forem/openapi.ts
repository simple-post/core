import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { ForemConnectRequestSchema, ForemConnectResponseSchema } from "@/lib/openapi/schemas";
export default defineRoute({
  path: "/api/connect/forem",
  methods: {
    post: {
      operationId: "connectForem",
      tags: ["Connect"],
      summary: "Connect a DEV/Forem API key",
      security: userAuthSecurity,
      requestBody: { required: true, content: { "application/json": { schema: ForemConnectRequestSchema } } },
      responses: {
        "200": jsonResponse("Forem connected.", ForemConnectResponseSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
