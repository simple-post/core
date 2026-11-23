import { knownOAuthErrorMessage, OAUTH_ERROR_MESSAGES, FACEBOOK_NO_PAGES_MESSAGE } from "@/lib/oauth/error-messages";

it("retains actionable provider guidance from known callback messages", () => {
  expect(knownOAuthErrorMessage(OAUTH_ERROR_MESSAGES.youtube_no_channel)).toContain("Brand Account");
  expect(knownOAuthErrorMessage(FACEBOOK_NO_PAGES_MESSAGE)).toBe(FACEBOOK_NO_PAGES_MESSAGE);
});
it("does not echo arbitrary error query text", () => {
  expect(knownOAuthErrorMessage("Visit an unrelated site and enter your password")).toBeNull();
  expect(knownOAuthErrorMessage(null)).toBeNull();
});
