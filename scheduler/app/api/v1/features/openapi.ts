import { Feature } from "@prisma/client";
import { z } from "zod";

import { defineRoute, jsonResponse, userAuthErrorResponses, userAuthSecurity } from "@/lib/openapi/helpers";

export default defineRoute({
  path: "/api/v1/features",
  methods: {
    get: {
      operationId: "listUserFeatures",
      tags: ["Features"],
      summary: "List features enabled for the authenticated user",
      security: userAuthSecurity,
      responses: {
        "200": jsonResponse("Enabled features.", z.object({ features: z.array(z.enum(Feature)) })),
        ...userAuthErrorResponses,
      },
    },
  },
});
