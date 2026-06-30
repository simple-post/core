import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { TelegramConnectRequestSchema, TelegramConnectResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/connect/telegram",
  methods: {
    post: {
      operationId: "connectTelegram",
      tags: ["Connect"],
      summary: "Connect a Telegram bot and chat",
      security: userAuthSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: TelegramConnectRequestSchema,
          },
        },
      },
      responses: {
        "200": jsonResponse("Telegram account connected.", TelegramConnectResponseSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
