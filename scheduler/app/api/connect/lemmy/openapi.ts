import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { LemmyConnectRequestSchema, LemmyConnectResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/connect/lemmy",
  methods: {
    post: {
      operationId: "connectLemmy",
      tags: ["Connect"],
      summary: "Connect a Lemmy account and default community",
      security: userAuthSecurity,
      requestBody: { required: true, content: { "application/json": { schema: LemmyConnectRequestSchema } } },
      responses: {
        "200": jsonResponse("Lemmy account connected.", LemmyConnectResponseSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
