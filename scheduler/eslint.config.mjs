import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import globals from "globals";
import path from "node:path";
import tseslint from "typescript-eslint";

const tseslintConfig = tseslint.config(eslint.configs.recommended, tseslint.configs.recommended);

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "public/**",
      ".github/**",
      "tsconfig.tsbuildinfo",
      "next-env.d.ts",
      "eslint.config.mjs",
      "postcss.config.mjs",
      "next.config.mjs",
      "prisma/migrations/**",
    ],
  },
  ...tseslintConfig,
  eslintConfigPrettier,
  eslintPluginUnicorn.configs.recommended,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  {
    files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"],
    plugins: {
      react,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        React: "readonly",
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "detect",
      },
      "import/resolver": {
        node: {
          paths: ["."],
          extensions: [".js", ".jsx", ".ts", ".d.ts", ".tsx"],
        },
        typescript: {
          project: "./tsconfig.json",
        },
        alias: {
          map: [["@", path.resolve(import.meta.dirname, ".")]],
          extensions: [".js", ".jsx", ".ts", ".d.ts", ".tsx"],
        },
      },
    },
    rules: {
      // React rules
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-react": "off",
      "react/self-closing-comp": "warn",
      "react/jsx-no-target-blank": "error",
      "react/jsx-curly-brace-presence": ["warn", { props: "never", children: "never" }],
      "react/display-name": "off",

      // React Hooks rules
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Accessibility rules
      "jsx-a11y/alt-text": "warn",
      "jsx-a11y/anchor-is-valid": "warn",
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",

      // TypeScript rules
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-var-requires": "warn",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-empty-object-type": "off",

      // General rules
      "no-undef": "off", // TypeScript handles this
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // Import rules
      "import/no-extraneous-dependencies": "off",
      "import/prefer-default-export": "off",
      "import/extensions": "off",
      "import/no-named-as-default-member": "off",
      "import/no-unresolved": "off", // TypeScript handles this
      "import/order": [
        "warn",
        {
          alphabetize: {
            caseInsensitive: true,
            order: "asc",
          },
          groups: ["builtin", "external", "internal", "parent", "sibling", "index", "type"],
          pathGroups: [
            {
              pattern: "react",
              group: "external",
              position: "before",
            },
            {
              pattern: "next/**",
              group: "external",
              position: "before",
            },
            {
              pattern: "@/**",
              group: "internal",
              position: "before",
            },
          ],
          pathGroupsExcludedImportTypes: ["react", "next/**"],
          "newlines-between": "always",
        },
      ],

      // Unicorn rules
      "unicorn/prevent-abbreviations": "off",
      "unicorn/no-null": "off",
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
      "unicorn/no-array-reduce": "off",
      "unicorn/no-array-for-each": "off",
      "unicorn/prefer-module": "off",
      "unicorn/prefer-node-protocol": "warn",
      "unicorn/prefer-global-this": "off", // window is fine in browser context
      "unicorn/no-nested-ternary": "off", // common in JSX conditionals
      "unicorn/no-useless-undefined": "off", // needed for React state
      "unicorn/prefer-top-level-await": "off", // tsconfig target doesn't support it
    },
  },
  // Next.js specific overrides for API routes and server components
  {
    files: ["app/api/**/*.ts", "lib/**/*.ts"],
    rules: {
      "no-console": "off", // Allow console in server-side code
    },
  },
  // Relaxed rules for UI components (shadcn/ui)
  {
    files: ["components/ui/**/*.tsx", "components/ui/**/*.ts", "hooks/use-toast.ts"],
    rules: {
      "react/jsx-sort-props": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "unicorn/filename-case": "off",
      "unicorn/explicit-length-check": "off",
      "unicorn/no-document-cookie": "off",
    },
  },
];

export default eslintConfig;
