import type { PlatformValidationRules } from "@simple-post/sdk";

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
  messageLength: number;
  maxTextLength?: number;
  validationResults: ValidationResultRow[];
  /** Create form: only X accounts using the shared message. Edit form: any selected X account. */
  requireXCommonContent: boolean;
}): {
  denominator: number;
  showLongPostOnXHint: boolean;
  countClassName: string;
} {
  const { messageLength, maxTextLength, validationResults, requireXCommonContent } = params;

  if (maxTextLength == null || maxTextLength <= 0) {
    return { denominator: 0, showLongPostOnXHint: false, countClassName: "text-xs text-muted-foreground" };
  }

  const xRow = validationResults.find((r) => rowSupportsXLongPostUi(r, requireXCommonContent));
  const standard = xRow?.rules.text?.standardMaxLength;
  if (!xRow || standard == null) {
    const over = messageLength > maxTextLength;
    return {
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

  return { denominator, showLongPostOnXHint, countClassName };
}
