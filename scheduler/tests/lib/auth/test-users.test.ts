import { authenticateTestUser } from "@/lib/auth/test-users";

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
});
