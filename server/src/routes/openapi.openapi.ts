import { defineRoute, jsonResponse } from "../openapi/helpers.js";
import { OpenApiDocumentSchema } from "../openapi/schemas.js";

export default defineRoute({
  path: "/openapi.json",
  methods: {
    get: {
      operationId: "getServerOpenApiDocument",
      tags: ["OpenAPI"],
      summary: "Get the generated Server OpenAPI document",
      responses: {
        "200": jsonResponse("Generated OpenAPI 3.1 document.", OpenApiDocumentSchema),
      },
    },
  },
});
