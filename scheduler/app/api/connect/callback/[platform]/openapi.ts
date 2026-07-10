import * as z from "zod";

import { defineRoute, redirectResponse } from "@/lib/openapi/helpers";

export default defineRoute({
  path: "/api/connect/callback/{platform}",
  methods: {
    get: {
      operationId: "handlePlatformConnectionCallback",
      tags: ["Connect"],
      summary: "Handle a social platform OAuth callback",
      description:
        "Validates OAuth state, exchanges the authorization code, stores connected accounts, and redirects to the app.",
      requestParams: {
        path: z.object({
          platform: z.string().meta({
            description: "Social platform slug.",
            example: "youtube",
          }),
        }),
        query: z.object({
          code: z.string().optional(),
          state: z.string().optional(),
          error: z.string().optional(),
          error_reason: z.string().optional(),
          error_description: z.string().optional(),
        }),
      },
      responses: {
        "302": redirectResponse("Redirect back to the Scheduler app with success or error state."),
      },
    },
  },
});
