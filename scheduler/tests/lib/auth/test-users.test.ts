import { isTestUserEmail } from "@/lib/auth/test-users";

it("identifies only the demo account, including normalized email addresses", () => {
  expect(isTestUserEmail(" DEMO@simplepost.social ")).toBe(true);
  expect(isTestUserEmail("openai@simplepost.social")).toBe(false);
  expect(isTestUserEmail("someone@example.com")).toBe(false);
  expect(isTestUserEmail(undefined)).toBe(false);
});
