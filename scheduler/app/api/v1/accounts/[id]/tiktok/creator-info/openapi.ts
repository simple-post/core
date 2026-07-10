import * as z from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { ApiErrorSchema, TikTokCreatorInfoEnvelopeSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/accounts/{id}/tiktok/creator-info",
  methods: {
    get: {
      operationId: "getTikTokCreatorInfo",
      tags: ["Accounts"],
      summary: "Get TikTok creator posting capabilities",
      description:
        "Refreshes the connected TikTok credential when needed and returns the creator's current privacy and interaction options.",
      security: userAuthSecurity,
      requestParams: {
        path: z.object({
          id: z.string().meta({ description: "TikTok connected account ID." }),
        }),
      },
      responses: {
        "200": jsonResponse("TikTok creator posting capabilities.", TikTokCreatorInfoEnvelopeSchema),
        "404": jsonResponse("Connected account not found.", ApiErrorSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
