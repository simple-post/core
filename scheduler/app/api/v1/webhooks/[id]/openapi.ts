import { basicErrorResponses, defineRoute, jsonResponse, userAuthSecurity } from "@/lib/openapi/helpers";
import { UpdateWebhookRequestSchema, WebhookSuccessResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/webhooks/{id}",
  methods: {
    patch: {
      operationId: "updateWebhook",
      tags: ["Webhooks"],
      summary: "Update a webhook endpoint",
      description: "Updates the URL, subscribed events, or active state of a webhook endpoint.",
      security: userAuthSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: UpdateWebhookRequestSchema,
          },
        },
      },
      responses: {
        "200": jsonResponse("Webhook endpoint updated.", WebhookSuccessResponseSchema),
        ...basicErrorResponses,
      },
    },
    delete: {
      operationId: "deleteWebhook",
      tags: ["Webhooks"],
      summary: "Delete a webhook endpoint",
      security: userAuthSecurity,
      responses: {
        "200": jsonResponse("Webhook endpoint deleted.", WebhookSuccessResponseSchema),
        ...basicErrorResponses,
      },
    },
  },
});
