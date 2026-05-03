import {
  apiKeyErrorResponses,
  apiKeySecurity,
  basicErrorResponses,
  defineRoute,
  jsonResponse,
} from "../openapi/helpers.js";
import { MediaFileResponseSchema } from "../openapi/schemas.js";

export default defineRoute({
  path: "/api/v1/upload",
  methods: {
    post: {
      operationId: "uploadMedia",
      tags: ["Upload"],
      summary: "Upload media",
      security: apiKeySecurity,
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              properties: {
                file: {
                  type: "string",
                  format: "binary",
                },
              },
              required: ["file"],
            },
          },
        },
      },
      responses: {
        "201": jsonResponse("Uploaded media reference.", MediaFileResponseSchema),
        ...apiKeyErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
