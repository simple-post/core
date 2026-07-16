import { authLogger } from "@/lib/logger";

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replaceAll(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeDisplayName(value: string | null | undefined, username: string) {
  const normalized = value?.replaceAll(/\s+/g, " ").trim();
  if (!normalized || normalized.toLowerCase() === username.toLowerCase() || normalized.length > 100) {
    return null;
  }
  return normalized;
}

export function extractPinterestDisplayName(html: string, username: string): string | null {
  const jsonNameMatch = html.match(/"full_name"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (jsonNameMatch?.[1]) {
    try {
      const parsed = JSON.parse(`"${jsonNameMatch[1]}"`) as string;
      const displayName = normalizeDisplayName(parsed, username);
      if (displayName) return displayName;
    } catch {
      // Fall through to the document title.
    }
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch?.[1]) return null;

  const title = decodeHtmlEntities(titleMatch[1]);
  const suffix = `(${username}) - Profile | Pinterest`;
  const displayName = title.toLowerCase().endsWith(suffix.toLowerCase()) ? title.slice(0, -suffix.length) : title;
  return normalizeDisplayName(displayName, username);
}

export async function fetchPinterestDisplayName(username: string): Promise<string | null> {
  if (!username) return null;

  try {
    const response = await fetch(`https://www.pinterest.com/${encodeURIComponent(username)}/`, {
      cache: "no-store",
      headers: {
        Accept: "text/html",
        "User-Agent": "SimplePost/1.0",
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      authLogger.warn(
        { status: response.status, statusText: response.statusText },
        "Failed to fetch public Pinterest profile",
      );
      return null;
    }

    return extractPinterestDisplayName(await response.text(), username);
  } catch (error) {
    authLogger.warn({ error }, "Failed to fetch public Pinterest profile");
    return null;
  }
}
