import * as z from "zod";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import {
  ApiErrorSchema,
  PendingConnectionResponseSchema,
  SelectPendingConnectionRequestSchema,
  SelectPendingConnectionResponseSchema,
} from "@/lib/openapi/schemas";

const requestParams = {
  path: z.object({
    id: z.string().meta({
      description: "Pending OAuth connection ID.",
    }),
  }),
};

export default defineRoute({
  path: "/api/connect/pending/{id}",
  methods: {
    get: {
      operationId: "getPendingConnection",
      tags: ["Connect"],
      summary: "Get pending OAuth connection accounts",
      security: userAuthSecurity,
      requestParams,
      responses: {
        "200": jsonResponse("Pending accounts available for selection.", PendingConnectionResponseSchema),
        "410": jsonResponse("Pending connection has expired.", ApiErrorSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
    post: {
      operationId: "selectPendingConnectionAccounts",
      tags: ["Connect"],
      summary: "Select accounts from a pending OAuth connection",
      security: userAuthSecurity,
      requestParams,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: SelectPendingConnectionRequestSchema,
          },
        },
      },
      responses: {
        "200": jsonResponse("Selected accounts were connected.", SelectPendingConnectionResponseSchema),
        "410": jsonResponse("Pending connection has expired.", ApiErrorSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
