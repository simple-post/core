import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { PostingSlotsEnvelopeSchema, PostingSlotsRequestSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/posting-slots",
  methods: {
    get: {
      operationId: "getPostingSlots",
      tags: ["Posts"],
      summary: "Get posting time slots",
      description: "Lists the user's recurring weekly posting time slots (local wall-clock times).",
      security: userAuthSecurity,
      responses: {
        "200": jsonResponse("Current posting time slots.", PostingSlotsEnvelopeSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
    put: {
      operationId: "updatePostingSlots",
      tags: ["Posts"],
      summary: "Replace posting time slots",
      description: "Replaces the full list of recurring weekly posting time slots.",
      security: userAuthSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: PostingSlotsRequestSchema,
          },
        },
      },
      responses: {
        "200": jsonResponse("Updated posting time slots.", PostingSlotsEnvelopeSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
