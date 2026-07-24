interface TestUser {
  name: string;
  password: string;
}

const TEST_USERS: Record<string, TestUser> = {
  "demo@simplepost.social": {
    name: "Demo User",
    password: "demo",
  },
  "openai@simplepost.social": {
    name: "OpenAI Test User",
    password: "openai",
  },
};

export function authenticateTestUser(email: string, password: string): Pick<TestUser, "name"> | undefined {
  const testUser = TEST_USERS[email];
  if (!testUser || password !== testUser.password) {
    return undefined;
  }

  return { name: testUser.name };
}
