import { FlatCompat } from "@eslint/eslintrc";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

export default tseslint.config(
  {
    ignores: [
      "dist",
      "coverage/**",
      "node_modules",
      "release/**",
      "src/components/ui/**",
      "src/components/ai-elements/**",
      "*.js",
      "*.config.ts",
      "vite.config.ts",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      "react-hooks": reactHooks,
    },
    extends: [...tseslint.configs.recommended],
    rules: {
      // Rules of Hooks · catches the "hook called after an early
      // return" pattern statically. We had 3 runtime crashes from
      // this in the past week (UserMenu / SwarmPanel /
      // AgentWorldUnified) that tsc couldn't see and existing
      // tests didn't touch. Enabling this at error-level is the
      // cheap permanent fix · no per-file smoke tests needed.
      "react-hooks/rules-of-hooks": "error",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "jsx-a11y/no-autofocus": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      // Disable strict type-checked rules for now
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      // Needs type information; enabled for src/ in the type-aware block.
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      // Needs type information; enabled for src/ in the type-aware block
      // below. Files outside tsconfig.json (e2e, electron, tests) keep it off.
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-inferrable-types": "warn",
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
      "@typescript-eslint/prefer-optional-chain": "off",
      "@typescript-eslint/prefer-regexp-exec": "off",
      "@typescript-eslint/no-base-to-string": "off",
    },
  },
  {
    // Type-aware rules. Scoped to the files tsconfig.json covers (tests are
    // excluded there), so the type checker can see every file linted here.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/test/setup.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // An un-awaited promise swallows its rejection. Mark intentional
      // fire-and-forget calls with `void`, await the rest, or `.catch` them.
      "@typescript-eslint/no-floating-promises": "error",
      // Passing an async function where a void callback is expected (timers,
      // event listeners, option callbacks, conditionals) drops its rejection.
      // JSX event props are exempt: React ignores handler return values and
      // `onClick={asyncHandler}` is the idiomatic form across the app.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      // An assertion the compiler can already prove only hides the next real
      // type change; src/test/type-assertion-ratchet.test.ts caps the rest.
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
    },
  },
  {
    // RATCHET — legacy files that still have floating promises. This is a
    // ratchet: fix a file, then delete it from this list; never add to it.
    // New files must pass.
    files: [
      "src/app/browser/page.tsx",
      "src/components/browser/assistant-panel.tsx",
      "src/components/workspace/browser-preview-panel.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    // RATCHET — legacy files that still pass promises where a void callback
    // is expected. Fix a file, then delete it from this list; never add to
    // it. New files must pass.
    files: [
      "src/components/browser/assistant-panel.tsx",
      "src/components/browser/password-prompt.tsx",
      "src/components/workspace/browser-preview-panel.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    // RATCHET — files with assertions the compiler already proves, left while
    // another change to them is in flight. Fix a file, then delete it here.
    files: [
      "src/components/browser/browser-store.tsx",
      "src/components/browser/webview-tab.tsx",
    ],
    rules: {
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
  {
    // Test files legitimately reach for `any` in partial mocks and
    // fixtures; the rule is noise there (it accounted for ~35 of the
    // warnings). Keep it on for production code.
    files: ["**/*.test.ts", "**/*.test.tsx", "src/test/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
