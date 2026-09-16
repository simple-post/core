import { Feature } from "@prisma/client";
import { canFitImageIssue, type ValidationIssue } from "@simple-post/sdk";

import { hasFeature } from "@/lib/features";

/**
 * Drafts intentionally allow incomplete text and platform settings, but users
 * with image fitting should not be allowed to persist an image that is already
 * known to be unpublishable. Return only the errors fitting can resolve so the
 * caller can keep the ordinary incomplete-draft exemption intact.
 */
export async function requiredDraftImageFittingErrors({
  errors,
  postingMode,
  userId,
}: {
  errors: ValidationIssue[];
  postingMode: string;
  userId: string;
}): Promise<ValidationIssue[]> {
  if (postingMode !== "draft") return [];

  const fittableErrors = errors.filter((issue) => canFitImageIssue(issue));
  if (fittableErrors.length === 0) return [];

  return (await hasFeature(userId, Feature.IMAGE_FITTING)) ? fittableErrors : [];
}
