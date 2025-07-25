module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/sdk/src", "<rootDir>/sdk/tests"],
  testMatch: ["**/__tests__/**/*.test.ts", "<rootDir>/sdk/tests/**/*.test.ts"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  collectCoverageFrom: ["sdk/src/**/*.ts", "!sdk/src/**/*.d.ts"],
  setupFilesAfterEnv: ["<rootDir>/sdk/tests/setup.ts"],
};
