import { type NextRequest, NextResponse } from "next/server";

import { locales, type Locale } from "@/lib/i18n/locales";
import { savedUiLocale } from "@/lib/i18n/saved-preference";
import { serverMessage } from "@/lib/i18n/server";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { hasAllowedOrigin } from "@/lib/middleware/origin";
import { prisma } from "@/lib/prisma";
import { BadRequestError, ForbiddenError, handleApiError } from "@/lib/utils/errors";

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireBrowserSession(req);
    return NextResponse.json({ locale: (await savedUiLocale(user.id)) ?? null });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    if (!hasAllowedOrigin(req)) throw new ForbiddenError();
    const { user } = await requireBrowserSession(req);
    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || !("locale" in body) || !locales.includes(body.locale as Locale)) {
      throw new BadRequestError(serverMessage("Unsupported interface language"));
    }
    await prisma.user.update({ where: { id: user.id }, data: { uiLocale: body.locale as Locale } });
    return NextResponse.json({ locale: body.locale });
  } catch (error) {
    return handleApiError(error, req);
  }
}
