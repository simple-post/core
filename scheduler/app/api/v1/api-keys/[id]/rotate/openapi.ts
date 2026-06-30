import * as z from "zod/v4";

import {
  basicErrorResponses,
  browserSessionSecurity,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
} from "@/lib/openapi/helpers";
import { RotateApiKeyResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/api-keys/{id}/rotate",
  methods: {
    post: {
      operationId: "rotateApiKey",
      tags: ["API Keys"],
      summary: "Rotate an API key",
      description:
        "Revokes the selected API key and creates a replacement with the same name. The new raw API key is returned once.",
      security: browserSessionSecurity,
      requestParams: {
        path: z.object({
          id: z.string(),
        }),
      },
      responses: {
        "201": jsonResponse("Rotated API key. The apiKey field is only returned once.", RotateApiKeyResponseSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
