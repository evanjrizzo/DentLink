import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "**/dist/**",
      "coverage/**",
      ".turbo/**",
      "**/.turbo/**",
      "pnpm-lock.yaml"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: false
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error"
    }
  }
];
