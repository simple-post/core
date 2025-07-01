module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/lib/src", "<rootDir>/lib/tests"],
  testMatch: ["**/__tests__/**/*.test.ts", "<rootDir>/lib/tests/**/*.test.ts"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  collectCoverageFrom: ["lib/src/**/*.ts", "!lib/src/**/*.d.ts"],
  setupFilesAfterEnv: ["<rootDir>/lib/tests/setup.ts"],
};
