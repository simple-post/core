import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { NostrConnectRequestSchema, NostrConnectResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/connect/nostr",
  methods: {
    post: {
      operationId: "connectNostr",
      tags: ["Connect"],
      summary: "Connect a Nostr private key and relays",
      security: userAuthSecurity,
      requestBody: { required: true, content: { "application/json": { schema: NostrConnectRequestSchema } } },
      responses: {
        "200": jsonResponse("Nostr account connected.", NostrConnectResponseSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
