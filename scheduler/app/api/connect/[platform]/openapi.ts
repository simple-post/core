import * as z from "zod/v4";

import {
  basicErrorResponses,
  defineRoute,
  redirectResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";

export default defineRoute({
  path: "/api/connect/{platform}",
  methods: {
    get: {
      operationId: "startPlatformConnection",
      tags: ["Connect"],
      summary: "Start a social platform OAuth connection",
      description: "Builds a provider authorization URL, stores PKCE state when needed, and redirects the user.",
      security: userAuthSecurity,
      requestParams: {
        path: z.object({
          platform: z.string().meta({
            description: "Social platform slug.",
            example: "youtube",
          }),
        }),
      },
      responses: {
        "302": redirectResponse("Redirect to the social platform authorization URL."),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
