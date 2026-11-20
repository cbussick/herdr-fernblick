import cloudflare from "@cloudflare/oxlint-config";
import { defineConfig } from "oxlint";

// Keep original correctness coverage without downgrading preset severities.
export default defineConfig({
  ...cloudflare,
  plugins: [...new Set([...(cloudflare.plugins ?? []), "react", "typescript", "oxc"])],
  rules: {
    ...cloudflare.rules,
    "no-caller": "warn",
    "no-iterator": "warn",
    "no-unassigned-vars": "warn",
    "oxc/bad-array-method-on-arguments": "warn",
    "oxc/bad-match-all-arg": "warn",
    "oxc/erasing-op": "warn",
    "oxc/only-used-in-recursion": "warn",
    "react/forward-ref-uses-ref": "warn",
    "react/no-did-mount-set-state": "warn",
    "react/no-did-update-set-state": "warn",
    "react/no-this-in-sfc": "warn",
    "react/no-unsafe": "warn",
    "react/no-will-update-set-state": "warn",
    "react/only-export-components": ["warn", { allowConstantExport: true }],
    "react/void-use-memo": "warn",
    "typescript/no-base-to-string": "warn",
    "typescript/no-implied-eval": "warn",
    "typescript/no-meaningless-void-operator": "warn",
    "typescript/no-redundant-type-constituents": "warn",
    "typescript/no-this-alias": "warn",
    "typescript/no-useless-default-assignment": "warn",
    "typescript/no-useless-empty-export": "warn",
    "typescript/restrict-template-expressions": "warn",
  },
  overrides: [
    ...(cloudflare.overrides ?? []),
    // The original configuration checked these in TypeScript and tests too.
    {
      files: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
      rules: {
        "constructor-super": "error",
        "getter-return": "error",
        "no-class-assign": "error",
        "no-const-assign": "error",
        "no-dupe-class-members": "error",
        "no-dupe-keys": "error",
        "no-func-assign": "error",
        "no-import-assign": "error",
        "no-new-native-nonconstructor": "error",
        "no-obj-calls": "error",
        "no-setter-return": "error",
        "no-this-before-super": "error",
        "no-unreachable": "error",
        "no-unsafe-negation": "error",
        "no-with": "error",
        "typescript/unbound-method": "error",
      },
    },
  ],
});
