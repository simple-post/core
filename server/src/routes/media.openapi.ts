import * as z from "zod/v4";

import { binaryResponse, defineRoute, jsonResponse, serverErrorResponses } from "../openapi/helpers.js";
import { ApiErrorSchema } from "../openapi/schemas.js";

export default defineRoute({
  path: "/media/{filename}",
  methods: {
    get: {
      operationId: "getUploadedMedia",
      tags: ["Media"],
      summary: "Serve uploaded media",
      description: "Public endpoint used by social platforms to fetch media returned by upload.",
      requestParams: {
        path: z.object({
          filename: z.string().meta({ description: "Stored media filename." }),
        }),
      },
      responses: {
        "200": binaryResponse("Media bytes."),
        "400": jsonResponse("Invalid filename.", ApiErrorSchema),
        "404": jsonResponse("File was not found.", ApiErrorSchema),
        ...serverErrorResponses,
      },
    },
  },
});
