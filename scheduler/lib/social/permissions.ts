const permissions: Readonly<Record<string, readonly string[]>> = {
  x: ["like.read", "like.write"],
  facebook: ["pages_read_engagement", "pages_read_user_content", "pages_manage_engagement"],
  instagram: ["instagram_business_manage_comments"],
  threads: ["threads_read_replies"],
  linkedin: ["r_member_social_feed", "w_member_social_feed"],
  youtube: ["https://www.googleapis.com/auth/youtube.force-ssl"],
};

export function enabledInboxScopes(platform: string): readonly string[] {
  const configured = process.env.SOCIAL_INBOX_OAUTH_PLATFORMS ?? "facebook,instagram,threads,x,youtube";
  const platforms = new Set(configured.toLowerCase().split(/[\s,]+/u));
  return platforms.has(platform) ? (permissions[platform] ?? []) : [];
}

export function hasInboxScopes(scope: string | undefined | null, required: readonly string[]): boolean {
  const granted = new Set(scope?.split(/[\s,]+/u));
  return required.every((permission) => granted.has(permission));
}
