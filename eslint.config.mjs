import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["node_modules/**", "dist/**", "coverage/**", ".turbo/**", "pnpm-lock.yaml"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
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
