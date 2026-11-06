import { localeFromRequestHeaders, normalizeLocale } from "@/lib/i18n/locales";
import { createServerCopy } from "@/lib/i18n/server";
import { isWidgetName, widgetRuntimeScript } from "@/lib/mcp/ui/runtime";

const RUNTIME_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/javascript; charset=utf-8",
  "Cross-Origin-Resource-Policy": "cross-origin",
  Expires: "0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
} as const;

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const locale = normalizeLocale(url.searchParams.get("ui_locale")) ?? localeFromRequestHeaders(request.headers);
  const copy = createServerCopy(locale);
  const mode = url.searchParams.get("mode");
  const mountId = url.searchParams.get("mount");

  if (!isWidgetName(mode)) {
    return new Response(copy("Unknown SimplePost widget mode."), {
      status: 400,
      headers: RUNTIME_HEADERS,
    });
  }
  if (!mountId || mountId.length > 256) {
    return new Response(copy("A valid mount identifier is required."), {
      status: 400,
      headers: RUNTIME_HEADERS,
    });
  }

  return new Response(widgetRuntimeScript(mode, mountId, locale), {
    headers: RUNTIME_HEADERS,
  });
}
