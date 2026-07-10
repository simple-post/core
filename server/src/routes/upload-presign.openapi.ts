import {
  apiKeyErrorResponses,
  apiKeySecurity,
  basicErrorResponses,
  defineRoute,
  jsonResponse,
} from "../openapi/helpers.js";
import { PresignUploadRequestSchema, PresignUploadResponseSchema } from "../openapi/schemas.js";

export default defineRoute({
  path: "/api/v1/upload/presign",
  methods: {
    post: {
      operationId: "createServerPresignedUploadUrl",
      tags: ["Upload"],
      summary: "Create a direct object-storage upload URL",
      security: apiKeySecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: PresignUploadRequestSchema },
        },
      },
      responses: {
        "200": jsonResponse("Presigned upload request and ready-to-use media reference.", PresignUploadResponseSchema),
        ...apiKeyErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
