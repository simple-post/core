module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^@simple-post/sdk$": "<rootDir>/../sdk/src/index.ts",
    "^@simple-post/sdk/platform-names$": "<rootDir>/../sdk/src/platform-names.ts",
    "^@simple-post/sdk/media-types$": "<rootDir>/../sdk/src/media-types.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          target: "ES2022",
          esModuleInterop: true,
          isolatedModules: true,
        },
      },
    ],
  },
};
