import { getXTextLength } from "@simple-post/sdk/validation";

import type { PlatformValidationRules } from "@simple-post/sdk";

import type { MediaFile } from "@/types";

type ValidationResultRow = {
  platform: string;
  usesCommonContent?: boolean;
  rules: PlatformValidationRules;
};

function rowSupportsXLongPostUi(row: ValidationResultRow, requireCommonContent: boolean): boolean {
  if (row.platform !== "x") return false;
  if (requireCommonContent && row.usesCommonContent === false) return false;
  const t = row.rules.text;
  const standard = t?.standardMaxLength ?? 0;
  const max = t?.maxLength ?? 0;
  return standard > 0 && max > standard;
}

/**
 * Character counter for the main post field when X long posts are allowed:
 * show a classic /280-style budget until the user passes it, then show the real hard max.
 */
export function getMainFieldCharCounterState(params: {
  message: string;
  maxTextLength?: number;
  validationResults: ValidationResultRow[];
  /** Create form: only X accounts using the shared message. Edit form: any selected X account. */
  requireXCommonContent: boolean;
}): {
  numerator: number;
  denominator: number;
  showLongPostOnXHint: boolean;
  countClassName: string;
} {
  const { message, maxTextLength, validationResults, requireXCommonContent } = params;
  const hasX = validationResults.some(
    (row) => row.platform === "x" && (!requireXCommonContent || row.usesCommonContent !== false),
  );
  const messageLength = hasX ? getXTextLength(message) : message.length;

  if (maxTextLength == null || maxTextLength <= 0) {
    return {
      numerator: messageLength,
      denominator: 0,
      showLongPostOnXHint: false,
      countClassName: "text-xs text-muted-foreground",
    };
  }

  const xRow = validationResults.find((r) => rowSupportsXLongPostUi(r, requireXCommonContent));
  const standard = xRow?.rules.text?.standardMaxLength;
  if (!xRow || standard == null) {
    const over = messageLength > maxTextLength;
    return {
      numerator: messageLength,
      denominator: maxTextLength,
      showLongPostOnXHint: false,
      countClassName: over ? "text-xs text-destructive" : "text-xs text-muted-foreground",
    };
  }

  const classicCap = Math.min(standard, maxTextLength);
  const inClassicWindow = messageLength <= classicCap;
  const denominator = inClassicWindow ? classicCap : maxTextLength;
  const showLongPostOnXHint = messageLength > classicCap && maxTextLength > classicCap;

  let countClassName = "text-xs text-muted-foreground";
  if (messageLength > maxTextLength) {
    countClassName = "text-xs text-destructive";
  } else if (showLongPostOnXHint) {
    countClassName = "text-xs text-amber-700 dark:text-amber-500/90";
  }

  return { numerator: messageLength, denominator, showLongPostOnXHint, countClassName };
}

/**
 * The tightest text limit among the given validation rows for this media:
 * caption limits apply once media is attached, plain text limits otherwise.
 */
export function getMaxTextLength(results: ValidationResultRow[], media: MediaFile[]): number | undefined {
  const hasMedia = media.length > 0;
  const hasVideo = media.some((item) => item.type === "video");
  const hasImage = media.some((item) => item.type === "image");

  const limits = results
    .map((result) => {
      const textRules = result.rules.text;
      if (!textRules) return undefined;

      if (hasMedia) {
        if (textRules.maxCaptionLengthByMediaType) {
          const candidates: number[] = [];
          if (hasVideo && textRules.maxCaptionLengthByMediaType.video) {
            candidates.push(textRules.maxCaptionLengthByMediaType.video);
          }
          if (hasImage && textRules.maxCaptionLengthByMediaType.image) {
            candidates.push(textRules.maxCaptionLengthByMediaType.image);
          }
          if (candidates.length > 0) {
            return Math.min(...candidates);
          }
        }
        return textRules.maxCaptionLength ?? textRules.maxLength;
      }

      return textRules.maxLength ?? textRules.maxCaptionLength;
    })
    .filter((limit): limit is number => typeof limit === "number");

  return limits.length > 0 ? Math.min(...limits) : undefined;
}
