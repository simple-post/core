import { basicErrorResponses, defineRoute, jsonResponse, userAuthSecurity } from "@/lib/openapi/helpers";
import { CreateWebhookRequestSchema, CreateWebhookResponseSchema, WebhooksEnvelopeSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/webhooks",
  methods: {
    get: {
      operationId: "listWebhooks",
      tags: ["Webhooks"],
      summary: "List webhook endpoints",
      description: "Lists webhook endpoints for the signed-in user. Signing secrets are never returned.",
      security: userAuthSecurity,
      responses: {
        "200": jsonResponse("Webhook endpoints for the signed-in user.", WebhooksEnvelopeSchema),
        ...basicErrorResponses,
      },
    },
    post: {
      operationId: "createWebhook",
      tags: ["Webhooks"],
      summary: "Create a webhook endpoint",
      description:
        "Registers an endpoint notified on post lifecycle events (post.published, post.failed). " +
        "Deliveries are signed with HMAC-SHA256: X-SimplePost-Signature is sha256=hex(hmac(secret, `${timestamp}.${body}`)) " +
        "with the timestamp from X-SimplePost-Timestamp. The secret is returned only once.",
      security: userAuthSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: CreateWebhookRequestSchema,
          },
        },
      },
      responses: {
        "201": jsonResponse("Created webhook endpoint including its one-time secret.", CreateWebhookResponseSchema),
        ...basicErrorResponses,
      },
    },
  },
});
