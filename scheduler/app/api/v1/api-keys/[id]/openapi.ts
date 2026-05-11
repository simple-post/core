import * as z from "zod/v4";

import {
  basicErrorResponses,
  browserSessionSecurity,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
} from "@/lib/openapi/helpers";
import { DeactivateApiKeyResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/api-keys/{id}",
  methods: {
    delete: {
      operationId: "deactivateApiKey",
      tags: ["API Keys"],
      summary: "Deactivate an API key",
      description: "Revokes an API key so it can no longer be used as a bearer token.",
      security: browserSessionSecurity,
      requestParams: {
        path: z.object({
          id: z.string(),
        }),
      },
      responses: {
        "200": jsonResponse("API key deactivated.", DeactivateApiKeyResponseSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
