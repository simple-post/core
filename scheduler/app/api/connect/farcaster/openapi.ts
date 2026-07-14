import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { FarcasterConnectRequestSchema, FarcasterConnectResponseSchema } from "@/lib/openapi/schemas";
export default defineRoute({
  path: "/api/connect/farcaster",
  methods: {
    post: {
      operationId: "connectFarcaster",
      tags: ["Connect"],
      summary: "Prepare or complete a scoped Farcaster signer authorization",
      security: userAuthSecurity,
      requestBody: { required: true, content: { "application/json": { schema: FarcasterConnectRequestSchema } } },
      responses: {
        "200": jsonResponse("Signer authorization prepared or Farcaster connected.", FarcasterConnectResponseSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
