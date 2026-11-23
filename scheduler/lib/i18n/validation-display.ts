import { IMAGE_FIT_HELP } from "@simple-post/sdk";

import type { ConnectedAccountCredentialStatus } from "@/types";
import { copyDisplayMessage, getDisplayMessage } from "@simple-post/sdk/validation";

import { createServerCopy, currentServerLocale, renderServerMessage, serverMessage } from "./server";

import type { Locale } from "./locales";
import type { AuthoredMessage, AuthoredValues } from "./server";
import type { ValidationResultByPlatform } from "../validation/post-validation";

export function validationMessage(issue: { message: string }, locale = currentServerLocale()): string {
  const descriptor = getDisplayMessage(issue);
  return descriptor && locale !== "en" ? renderServerMessage(descriptor, locale) : issue.message;
}

export function validationIssue<T extends { message: string }>(issue: T, locale = currentServerLocale()): T {
  return copyDisplayMessage(issue, { ...issue, message: validationMessage(issue, locale) });
}

/** Only structured validation fields are visited; post text, account names and metadata remain untouched. */
export function validationDisplay(
  result: ValidationResultByPlatform,
  locale = currentServerLocale(),
): ValidationResultByPlatform {
  return {
    ...result,
    results: result.results.map((row) => ({
      ...row,
      errors: row.errors.map((issue) => validationIssue(issue, locale)),
      warnings: row.warnings.map((issue) => validationIssue(issue, locale)),
    })),
    summary: {
      ...result.summary,
      errors: result.summary.errors.map((issue) => validationIssue(issue, locale)),
      warnings: result.summary.warnings.map((issue) => validationIssue(issue, locale)),
    },
  };
}

export function validationDetails(value: unknown, locale: Locale): unknown {
  if (
    !value ||
    typeof value !== "object" ||
    !("results" in value) ||
    !Array.isArray(value.results) ||
    !("summary" in value) ||
    !value.summary ||
    typeof value.summary !== "object"
  )
    return value;
  const hasIssues = (row: unknown) => {
    if (!row || typeof row !== "object" || !("errors" in row) || !("warnings" in row)) return false;
    const isIssueList = (list: unknown) =>
      Array.isArray(list) && list.every((issue) => issue && typeof issue.message === "string");
    return isIssueList(row.errors) && isIssueList(row.warnings);
  };
  if (!hasIssues(value.summary) || !value.results.every((result) => hasIssues(result))) return value;
  const translated = validationDisplay(value as ValidationResultByPlatform, locale);
  return "imageFitHelp" in value && value.imageFitHelp === IMAGE_FIT_HELP
    ? { ...translated, imageFitHelp: createServerCopy(locale)(IMAGE_FIT_HELP) }
    : translated;
}

/** Compose translated authored issues while preserving unknown/provider messages verbatim. */
export function joinedValidationMessages(issues: Array<{ message: string }>, separator = "; "): AuthoredMessage {
  const values: AuthoredValues = {};
  const source = issues
    .map((issue, index) => {
      values[`item${index}`] = getDisplayMessage(issue) ?? serverMessage("{{message}}", { message: issue.message });
      return `{{item${index}}}`;
    })
    .join(separator);
  return serverMessage(source, values);
}

export function credentialStatusDisplay(status: ConnectedAccountCredentialStatus, locale = currentServerLocale()) {
  return { ...status, label: createServerCopy(locale)(status.label), message: validationMessage(status, locale) };
}
