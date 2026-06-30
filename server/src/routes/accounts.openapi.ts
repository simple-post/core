import {
  apiKeyErrorResponses,
  apiKeySecurity,
  basicErrorResponses,
  defineRoute,
  jsonResponse,
} from "../openapi/helpers.js";
import { AccountsEnvelopeSchema } from "../openapi/schemas.js";

export default defineRoute({
  path: "/api/v1/accounts",
  methods: {
    get: {
      operationId: "listConfiguredAccounts",
      tags: ["Accounts"],
      summary: "List configured accounts",
      security: apiKeySecurity,
      responses: {
        "200": jsonResponse("Configured accounts without credentials.", AccountsEnvelopeSchema),
        ...apiKeyErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
