import * as z from "zod/v4";

import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { PinterestBoardsEnvelopeSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/accounts/{id}/boards",
  methods: {
    get: {
      operationId: "listPinterestBoards",
      tags: ["Accounts"],
      summary: "List Pinterest boards for an account",
      security: userAuthSecurity,
      requestParams: {
        path: z.object({
          id: z.string().meta({ description: "Pinterest connected account ID." }),
        }),
      },
      responses: {
        "200": jsonResponse("Pinterest boards for the connected account.", PinterestBoardsEnvelopeSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
