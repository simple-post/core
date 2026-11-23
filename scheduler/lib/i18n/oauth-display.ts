import { NextResponse } from "next/server";

import { localeFromRequestHeaders } from "./locales";
import { canonicalMessage, renderServerMessage, type AuthoredMessage } from "./server";

/** RFC 6749 limits error_description to ASCII. The app can display the separate Unicode message. */
export function oauthError(
  request: { headers: Headers },
  error: string,
  description: string | AuthoredMessage,
  init: ResponseInit,
) {
  const error_description = canonicalMessage(description);
  const locale = localeFromRequestHeaders(request.headers);
  const message =
    typeof description !== "string" && locale !== "en" ? renderServerMessage(description, locale) : undefined;
  return NextResponse.json(
    { error, error_description, ...(message && message !== error_description && { message }) },
    init,
  );
}
