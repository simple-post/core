import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { SchedulerUploadResponseSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/upload",
  methods: {
    post: {
      operationId: "uploadMedia",
      tags: ["Upload"],
      summary: "Upload media through the Scheduler app",
      security: userAuthSecurity,
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
        "200": jsonResponse("Uploaded media metadata.", SchedulerUploadResponseSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
