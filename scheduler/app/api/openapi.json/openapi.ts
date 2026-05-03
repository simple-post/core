import { defineRoute, jsonResponse } from "@/lib/openapi/helpers";
import { OpenApiDocumentSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/openapi.json",
  methods: {
    get: {
      operationId: "getSchedulerOpenApiDocument",
      tags: ["OpenAPI"],
      summary: "Get the generated Scheduler OpenAPI document",
      responses: {
        "200": jsonResponse("Generated OpenAPI 3.1 document.", OpenApiDocumentSchema),
      },
    },
  },
});
