import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { handleApiError, BadRequestError } from "@/lib/utils/errors";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";
import type { AccountOverridesMap, MediaFile } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const body = await req.json();

    const {
      message = "",
      media = [],
      accountIds = [],
      accountOverrides = {},
    } = body as {
      message?: string;
      media?: unknown[];
      accountIds?: string[];
      accountOverrides?: AccountOverridesMap;
    };

    if (!Array.isArray(accountIds) || accountIds.length === 0) {
      throw new BadRequestError("accountIds are required for validation");
    }

    const validation = await validatePostForAccounts({
      userId: session.user.id,
      message: typeof message === "string" ? message : "",
      media: Array.isArray(media) ? (media as MediaFile[]) : [],
      accountIds,
      accountOverrides: accountOverrides || {},
    });

    return NextResponse.json(validation);
  } catch (error) {
    return handleApiError(error);
  }
}
