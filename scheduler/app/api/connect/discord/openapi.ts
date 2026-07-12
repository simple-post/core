import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { DiscordConnectRequestSchema, DiscordConnectResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/connect/discord",
  methods: {
    post: {
      operationId: "connectDiscord",
      tags: ["Connect"],
      summary: "Connect a Discord incoming webhook",
      security: userAuthSecurity,
      requestBody: { required: true, content: { "application/json": { schema: DiscordConnectRequestSchema } } },
      responses: {
        "200": jsonResponse("Discord webhook connected.", DiscordConnectResponseSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
