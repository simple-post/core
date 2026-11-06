import { type NextRequest, NextResponse } from "next/server";

import { localeFromRequestHeaders } from "@/lib/i18n/locales";
import { openApiDisplay } from "@/lib/i18n/openapi-display";
import { createServerCopy } from "@/lib/i18n/server";
import { createSchedulerOpenApiDocument } from "@/lib/openapi/document";

export function GET(req: NextRequest) {
  return NextResponse.json(
    openApiDisplay(createSchedulerOpenApiDocument(), createServerCopy(localeFromRequestHeaders(req.headers))),
  );
}
