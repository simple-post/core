import { z } from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";

export default defineRoute({
  path: "/api/connect/handoff",
  methods: {
    post: {
      operationId: "prepareSocialConnectionHandoff",
      tags: ["Connect"],
      summary: "Validate an assistant connection link for the signed-in user",
      security: userAuthSecurity,
      requestBody: {
        required: true,
        content: { "application/json": { schema: z.object({ platform: z.string(), handoffToken: z.string() }) } },
      },
      responses: {
        "200": jsonResponse(
          "Continue to provider authorization or the manual setup form.",
          z.object({ connectionType: z.enum(["oauth", "manual"]), startUrl: z.string().optional() }),
        ),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
