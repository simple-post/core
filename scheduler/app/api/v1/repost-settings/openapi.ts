import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { RepostSettingsEnvelopeSchema, RepostSettingsRequestSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/repost-settings",
  methods: {
    get: {
      operationId: "getRepostSettings",
      tags: ["Posts"],
      summary: "Get default repost settings",
      security: userAuthSecurity,
      responses: {
        "200": jsonResponse("Current default repost settings.", RepostSettingsEnvelopeSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
    put: {
      operationId: "updateRepostSettings",
      tags: ["Posts"],
      summary: "Update default repost settings",
      security: userAuthSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: RepostSettingsRequestSchema,
          },
        },
      },
      responses: {
        "200": jsonResponse("Updated default repost settings.", RepostSettingsEnvelopeSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
