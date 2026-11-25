export const DEMO_LOGIN_EMAIL = "demo@simplepost.social";
export const MUSE_REVIEW_LOGIN_EMAIL = "muse-review@simplepost.social";
export const MUSE_REVIEW_PASSWORD_LENGTH = 48;

export function isTestUserEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().toLowerCase() === DEMO_LOGIN_EMAIL;
}

export function isMuseReviewUserEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().toLowerCase() === MUSE_REVIEW_LOGIN_EMAIL;
}

export function isMuseReviewPassword(value: string | undefined): value is string {
  return value?.length === MUSE_REVIEW_PASSWORD_LENGTH && /^[a-f0-9]+$/.test(value);
}
