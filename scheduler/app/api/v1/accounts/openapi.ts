import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { AccountsEnvelopeSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/accounts",
  methods: {
    get: {
      operationId: "listConnectedAccounts",
      tags: ["Accounts"],
      summary: "List connected accounts",
      security: userAuthSecurity,
      responses: {
        "200": jsonResponse("Connected social accounts for the authenticated user.", AccountsEnvelopeSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
