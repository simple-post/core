import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";
import { validationRequestSchema } from "@/lib/validations/posts";

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const body = await req.json();

    const validated = validationRequestSchema.parse(body);

    const validation = await validatePostForAccounts({
      imageFit: validated.imageFit,
      userId: session.user.id,
      message: validated.message,
      media: validated.media,
      accountIds: validated.accountIds,
      accountOptions: validated.accountOptions,
      accountOverrides: validated.accountOverrides || {},
      thread: validated.thread,
    });

    return NextResponse.json({
      ...validation,
      ...(validated.imageFit
        ? {
            fittedContent: {
              media: validated.media,
              accountOverrides: validated.accountOverrides,
              accountOptions: validated.accountOptions,
              thread: validated.thread,
            },
          }
        : {}),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
