import * as z from "zod";

import {
  basicErrorResponses,
  defineRoute,
  emptyResponse,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { ApiErrorSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/accounts/{id}/avatar",
  methods: {
    get: {
      operationId: "getAccountAvatar",
      tags: ["Accounts"],
      summary: "Fetch a connected account avatar",
      description: "Proxies an allowlisted X or LinkedIn profile image for the authenticated account owner.",
      security: userAuthSecurity,
      requestParams: {
        path: z.object({
          id: z.string().meta({ description: "Connected account ID." }),
        }),
      },
      responses: {
        "200": {
          description: "Account avatar image bytes.",
          content: {
            "image/*": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
        "404": jsonResponse("Account or profile picture not found.", ApiErrorSchema),
        "502": emptyResponse("The upstream avatar could not be fetched as an image."),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
