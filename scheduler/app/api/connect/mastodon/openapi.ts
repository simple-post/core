import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { MastodonConnectRequestSchema, MastodonConnectResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/connect/mastodon",
  methods: {
    post: {
      operationId: "connectMastodon",
      tags: ["Connect"],
      summary: "Connect a Mastodon account",
      security: userAuthSecurity,
      requestBody: {
        required: true,
        content: { "application/json": { schema: MastodonConnectRequestSchema } },
      },
      responses: {
        "200": jsonResponse("Mastodon account connected.", MastodonConnectResponseSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
