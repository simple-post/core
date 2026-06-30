/**
 * Unit tests for scheduler library code (lib/**). These cover pure logic and
 * database-free behavior; modules with side effects (Prisma, posting) are
 * mocked per test file.
 */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  setupFiles: ["<rootDir>/tests/setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^@simple-post/sdk$": "<rootDir>/../sdk/src/index.ts",
    "^@simple-post/sdk/validation$": "<rootDir>/../sdk/src/validation.ts",
    "^@simple-post/sdk/media-types$": "<rootDir>/../sdk/src/media-types.ts",
    "^@simple-post/sdk/platform-names$": "<rootDir>/../sdk/src/platform-names.ts",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          target: "ES2022",
          jsx: "react-jsx",
          esModuleInterop: true,
        },
      },
    ],
  },
};
