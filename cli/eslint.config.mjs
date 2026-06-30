import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import globals from "globals";
import path from "node:path";
import tseslint from "typescript-eslint";

const tseslintConfig = tseslint.config(eslint.configs.recommended, tseslint.configs.recommended);

const eslintConfig = [
  {
    ignores: [
      "node_modules",
      "dist",
      "bin",
      "coverage",
      "oclif.manifest.json",
      "eslint.config.mjs",
      "jest.config.cjs",
      "scripts",
    ],
  },
  ...tseslintConfig,
  eslintConfigPrettier,
  eslintPluginUnicorn.configs.recommended,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.jest,
        ...globals.node,
      },
    },
    settings: {
      "import/resolver": {
        node: {
          paths: ["src"],
          extensions: [".js", ".ts", ".d.ts"],
        },
        typescript: {
          project: path.resolve(import.meta.dirname, "./tsconfig.json"),
          alwaysTryTypes: true,
        },
      },
    },
    rules: {
      "import/no-extraneous-dependencies": "off",
      "import/no-unresolved": "off", // TypeScript handles this
      "import/prefer-default-export": "off",
      "import/extensions": "off",
      "@typescript-eslint/no-explicit-any": ["warn"],
      "@typescript-eslint/consistent-type-imports": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "unicorn/prevent-abbreviations": "off",
      "unicorn/no-null": "off",
      // oclif command classes use static members and process.exit-style flows
      "unicorn/no-process-exit": "off",
      "unicorn/no-static-only-class": "off",
      // (await x).y and .map(fn) are established idiom throughout this package
      "unicorn/no-await-expression-member": "off",
      "unicorn/no-array-callback-reference": "off",
      // Conflicts with prettier, which strips the parentheses this rule wants
      "unicorn/no-nested-ternary": "off",
      "import/order": [
        "warn",
        {
          alphabetize: {
            caseInsensitive: true,
            order: "asc",
          },
          groups: ["builtin", "external", "index", "sibling", "parent", "internal", "type"],
          pathGroupsExcludedImportTypes: ["types"],
          "newlines-between": "always",
        },
      ],
      "import/no-named-as-default-member": "off",
      "unicorn/filename-case": [
        "error",
        {
          cases: {
            camelCase: true,
            pascalCase: true,
            kebabCase: true,
          },
        },
      ],
      "unicorn/consistent-function-scoping": "off",
    },
  },
  {
    files: ["**/*.test.{js,ts}", "**/tests/**/*.{js,ts}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // Tests run under ts-jest (CJS) and stub fetch on `global`
      "unicorn/prefer-module": "off",
      "unicorn/prefer-global-this": "off",
    },
  },
];

export default eslintConfig;
