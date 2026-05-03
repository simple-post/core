import { defineRoute, jsonResponse } from "../openapi/helpers.js";
import { HealthResponseSchema } from "../openapi/schemas.js";

export default defineRoute({
  path: "/health",
  methods: {
    get: {
      operationId: "getHealth",
      tags: ["Health"],
      summary: "Check server health",
      responses: {
        "200": jsonResponse("Server is healthy.", HealthResponseSchema),
      },
    },
  },
});
