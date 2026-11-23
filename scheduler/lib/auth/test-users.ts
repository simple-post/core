export const DEMO_LOGIN_EMAIL = "demo@simplepost.social";

export function isTestUserEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().toLowerCase() === DEMO_LOGIN_EMAIL;
}
