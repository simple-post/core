import { NextResponse } from "next/server";

import { createSchedulerOpenApiDocument } from "@/lib/openapi/document";

export function GET() {
  return NextResponse.json(createSchedulerOpenApiDocument());
}
