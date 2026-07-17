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
      "target/**",
      "**/target/**",
      "**/src-tauri/gen/**",
      "pnpm-lock.yaml"
    ]
  },
  js.configs.recommended,
  {
    files: ["scripts/**/*.mjs", "experimental/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        fetch: "readonly",
        process: "readonly"
      }
    }
  },
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
