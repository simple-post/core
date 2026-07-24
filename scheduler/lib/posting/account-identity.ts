/**
 * Return a normalized social handle for observability. Connected-account
 * usernames are provider handles on supported social platforms, but LinkedIn
 * currently stores the account email in that column and must not be rendered
 * as an @handle.
 */
export function getPlatformAccountHandle(platform: string, username: string | null | undefined): string | undefined {
  const normalizedUsername = username?.trim().replace(/^@+/, "");
  if (!normalizedUsername || platform.toLowerCase() === "linkedin") return undefined;
  return `@${normalizedUsername}`;
}
