// These are incremental permissions. Authorization requests add them only
// for an invited user's explicit inbox connection and an approved app.
const permissions: Readonly<Record<string, readonly string[]>> = {
  x: ["like.write"],
  facebook: ["pages_read_engagement", "pages_read_user_content", "pages_manage_engagement"],
  instagram: ["instagram_business_manage_comments"],
  threads: ["threads_read_replies"],
  linkedin: ["r_member_social_feed", "w_member_social_feed"],
  youtube: ["https://www.googleapis.com/auth/youtube.force-ssl"],
};

export function approvedInboxScopes(platform: string): readonly string[] {
  const approved = new Set((process.env.SOCIAL_INBOX_OAUTH_PLATFORMS ?? "").split(",").map((value) => value.trim()));
  return approved.has(platform) ? (permissions[platform] ?? []) : [];
}

export function hasInboxScopes(scope: string | undefined | null, required: readonly string[]): boolean {
  const granted = new Set(scope?.split(/[\s,]+/u));
  return required.every((permission) => granted.has(permission));
}
