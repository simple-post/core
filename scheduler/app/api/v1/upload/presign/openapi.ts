import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { PresignUploadRequestSchema, PresignUploadResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/upload/presign",
  methods: {
    post: {
      operationId: "createPresignedUploadUrl",
      tags: ["Upload"],
      summary: "Create a presigned upload URL",
      security: userAuthSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: PresignUploadRequestSchema,
          },
        },
      },
      responses: {
        "200": jsonResponse("Presigned upload URL and public media URL.", PresignUploadResponseSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
