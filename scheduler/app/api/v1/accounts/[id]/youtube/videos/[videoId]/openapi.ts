import * as z from "zod";
import {
  basicErrorResponses,
  defineRoute,
  jsonResponse,
  userAuthErrorResponses,
  userAuthSecurity,
} from "@/lib/openapi/helpers";
import { ApiErrorSchema } from "@/lib/openapi/schemas";

export default defineRoute({
  path: "/api/v1/accounts/{id}/youtube/videos/{videoId}",
  methods: {
    get: {
      operationId: "getYouTubeVideo",
      tags: ["Accounts"],
      summary: "Read a connected channel video from YouTube",
      description:
        "Fetches current owner-authorized data from YouTube using the connected account. Does not return tokens or infer metadata from saved posting options.",
      security: userAuthSecurity,
      requestParams: {
        path: z.object({ id: z.string(), videoId: z.string() }),
        query: z.object({ playlistId: z.string().optional() }),
      },
      responses: {
        "200": jsonResponse("Live YouTube provider data.", z.record(z.string(), z.unknown())),
        "404": jsonResponse("Account or channel resource not found.", ApiErrorSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
