import * as z from "zod/v4";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { DisconnectAccountResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/accounts/{id}",
  methods: {
    delete: {
      operationId: "disconnectAccount",
      tags: ["Accounts"],
      summary: "Disconnect an account",
      security: userAuthSecurity,
      requestParams: {
        path: z.object({
          id: z.string().meta({ description: "Connected account ID." }),
        }),
      },
      responses: {
        "200": jsonResponse("Account disconnected.", DisconnectAccountResponseSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
