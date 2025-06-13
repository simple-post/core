module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/lib/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  collectCoverageFrom: ["lib/src/**/*.ts", "!lib/src/**/*.d.ts"],
  setupFilesAfterEnv: ["<rootDir>/lib/src/__tests__/setup.ts"],
};
