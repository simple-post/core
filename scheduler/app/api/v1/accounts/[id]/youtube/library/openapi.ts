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
  path: "/api/v1/accounts/{id}/youtube/library",
  methods: {
    get: {
      operationId: "getYouTubeLibrary",
      tags: ["Accounts"],
      summary: "Read connected YouTube channels and playlists",
      description:
        "Fetches current owner-authorized data from YouTube using the connected account. Does not return tokens or infer metadata from saved posting options.",
      security: userAuthSecurity,
      requestParams: { path: z.object({ id: z.string() }), query: z.object({ pageToken: z.string().optional() }) },
      responses: {
        "200": jsonResponse("Live YouTube provider data.", z.record(z.string(), z.unknown())),
        "404": jsonResponse("Account or channel resource not found.", ApiErrorSchema),
        ...userAuthErrorResponses,
        ...basicErrorResponses,
      },
    },
  },
});
