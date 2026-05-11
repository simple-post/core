import {
  basicErrorResponses,
  browserSessionSecurity,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
} from "@/lib/openapi/helpers";
import { ApiKeysEnvelopeSchema, CreateApiKeyRequestSchema, CreateApiKeyResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/api-keys",
  methods: {
    get: {
      operationId: "listApiKeys",
      tags: ["API Keys"],
      summary: "List API keys",
      description: "Lists API key records for the signed-in user. Raw API key values are never returned.",
      security: browserSessionSecurity,
      responses: {
        "200": jsonResponse("API keys for the signed-in user.", ApiKeysEnvelopeSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
    post: {
      operationId: "createApiKey",
      tags: ["API Keys"],
      summary: "Create an API key",
      description: "Creates a new API key and returns the raw key once. Store it immediately.",
      security: browserSessionSecurity,
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: CreateApiKeyRequestSchema,
          },
        },
      },
      responses: {
        "201": jsonResponse("Created API key. The apiKey field is only returned once.", CreateApiKeyResponseSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
