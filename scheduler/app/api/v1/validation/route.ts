import { type NextRequest, NextResponse } from "next/server";

import { Feature } from "@prisma/client";
import { canFitImageIssue, IMAGE_FIT_HELP } from "@simple-post/sdk";

import { hasFeature } from "@/lib/features";
import { ingestPostMedia } from "@/lib/media-ingestion";
import { requireAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/utils/errors";
import { queueStorageDeletion } from "@/lib/utils/storage-lifecycle";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";
import { validationRequestSchema } from "@/lib/validations/posts";

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    const body = await req.json();
    const mediaPreflight = req.nextUrl.searchParams.get("mediaPreflight") === "1";

    let validated = validationRequestSchema.parse(body);

    // Fitting derives new images from the sources and returns them for the
    // caller to persist, so the sources come into owned storage first — the
    // same order the create and update routes use. Plain validation stays a
    // read-only preflight and imports nothing.
    if (validated.imageFit) {
      validated = await ingestPostMedia(session.user.id, validated, {
        onUploaded: async (url) => {
          // A review may be abandoned, so imports are registered for retention
          // exactly like the fitted derivatives. Saving the post spares them.
          await prisma.$transaction((tx) => queueStorageDeletion(tx, session.user.id, url));
        },
      });
    }

    const validation = await validatePostForAccounts({
      checkAccountReadiness: !mediaPreflight,
      imageFit: validated.imageFit,
      userId: session.user.id,
      message: validated.message,
      media: validated.media,
      accountIds: validated.accountIds,
      accountOptions: validated.accountOptions,
      accountOverrides: validated.accountOverrides || {},
      thread: validated.thread,
    });
    const fittingIssues = [...validation.summary.errors, ...validation.summary.warnings].filter((issue) =>
      canFitImageIssue(issue),
    );
    const imageFitHelp =
      fittingIssues.length > 0 && (await hasFeature(session.user.id, Feature.IMAGE_FITTING))
        ? IMAGE_FIT_HELP
        : undefined;

    return NextResponse.json({
      ...validation,
      ...(imageFitHelp ? { imageFitHelp } : {}),
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
