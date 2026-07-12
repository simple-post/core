import * as z from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { SlackChannelsEnvelopeSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/accounts/{id}/channels",
  methods: {
    get: {
      operationId: "listSlackChannels",
      tags: ["Accounts"],
      summary: "List Slack channels for an account",
      security: userAuthSecurity,
      requestParams: { path: z.object({ id: z.string().meta({ description: "Slack connected account ID." }) }) },
      responses: {
        "200": jsonResponse("Slack channels visible to the connected app.", SlackChannelsEnvelopeSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
