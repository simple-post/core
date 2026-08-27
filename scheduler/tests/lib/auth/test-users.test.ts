import { authenticateTestUser, isTestUserEmail } from "@/lib/auth/test-users";

describe("authenticateTestUser", () => {
  it.each([
    ["demo@simplepost.social", "demo", "Demo User"],
    ["openai@simplepost.social", "openai", "OpenAI Test User"],
  ])("accepts the configured credentials for %s", (email, password, name) => {
    expect(authenticateTestUser(email, password)).toEqual({ name });
  });

  it.each([
    ["demo@simplepost.social", "openai"],
    ["openai@simplepost.social", "demo"],
    ["someone@example.com", "demo"],
  ])("rejects invalid credentials for %s", (email, password) => {
    expect(authenticateTestUser(email, password)).toBeUndefined();
  });

  it("identifies only the configured review accounts", () => {
    expect(isTestUserEmail(" DEMO@simplepost.social ")).toBe(true);
    expect(isTestUserEmail("openai@simplepost.social")).toBe(true);
    expect(isTestUserEmail("someone@example.com")).toBe(false);
    expect(isTestUserEmail(undefined)).toBe(false);
  });
});
