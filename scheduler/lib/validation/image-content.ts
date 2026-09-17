import type { ImageFitContent } from "@simple-post/sdk";

/** Browser-safe check used to decide when byte-level image validation should run. */
export function hasImageContent(content: ImageFitContent): boolean {
  const mediaHasImage = (media = content.media) =>
    media.some((item) => item.type === "image" || (item.type === "video" && !!item.thumbnailUrl));

  if (mediaHasImage()) return true;
  if ((content.thread ?? []).some((segment) => mediaHasImage(segment.media ?? []))) return true;
  if (
    Object.values(content.accountOverrides ?? {}).some(
      (override) =>
        mediaHasImage(override.media ?? []) ||
        (override.thread ?? []).some((segment) => mediaHasImage(segment.media ?? [])),
    )
  )
    return true;

  return Object.values(content.accountOptions ?? {}).some(
    (options) => options && typeof options.thumbnailUrl === "string" && options.thumbnailUrl.length > 0,
  );
}
