# Cloudflare Oxlint migration audit

## Scope and configuration

Local branch `chore/cloudflare-oxlint-defaults`, based on
`3c8c143543df791cbd016bf6169eab557cd48855`. No integration, push, deployment,
production access or live-agent interaction was performed.

Node 24.22.1; npm/lockfile installs Cloudflare 0.1.0, nkzw 3.0.0,
Oxlint 1.94.0 and tsrs 0.25.0-ts7.1.0-beta. `npm ls` validates peers.
The official README and full migration skill were consulted.
`oxlint.config.ts` root-spreads the complete preset (including environments,
plugins, style and type-aware checks), retains inherited overrides and restores
stronger original correctness rules, including unbound methods in tests.
No custom Vokhanhbel plugins existed in this repository. Existing CSS Modules,
font-license, Stylelint, compiler, build and Knip coverage remains enabled.

Initial preset inventory: 4,356 diagnostics across 54 codes. Final full inventory:
zero diagnostics, 341 files, 256 rules (`/tmp/cf-final-inventory.json`).
No migration convenience disables or blanket file grandfathering remain.

## Implementation

Mechanical formatting, braces, imports, optional properties and collection fixes
are accompanied by boundary and ownership changes rather than assertion chains:

- JSON, socket frames, captured test messages, session metadata and backups are
  parsed at their owners; invalid/legacy engine tags retain explicit rejection.
- DOM capability checks work across windows; native fixture elements exercise
  focus restoration and clicked-image selection rather than asserted fake nodes.
- Session trees, asynchronous callbacks, model operations, board grants and
  renderer requests have explicit ownership and concrete capability contracts.
- Whiteboard/canvas and React route/connection/link state reconcile obsolete
  epochs before children commit. Regression tests cover replacement and stale
  callbacks. Editor fixtures use native Pi editor/TUI objects.
- Extension tests now load an inline extension through the SDK resource loader;
  SDK owns overloaded event and generic tool registration. Contexts originate
  from the native runner and retain checked model/session capabilities. Event
  dispatch promises are awaited, including cleanup. Tests target this checkout's
  pinned SDK: unchecked `PI_TREE_TEST_MODULE`/`PI_EDITOR_TEST_MODULE` alternate
  installation hooks were removed; optional extension-path testing remains.
- Four new test-only helper modules are excluded from Knip's production project,
  matching existing test fixture treatment; normal-mode dependency analysis and
  TypeScript/test coverage remain. `flowScene.ts` received final formatter cleanup.

Tests were not skipped, timeouts were not increased to pass validation, and no
microtask was added to conceal React mutations. The original branch's diagnostic
warnings were investigated rather than treated as permission to weaken defaults.

## Exact narrow exceptions

Each is a single annotated source location, not a preset/config override:

| File                        | Rule                                  | Reason                                                                                                               |
| --------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `Whiteboard.tsx`            | `react/set-state-in-effect`           | Effect owns an external BoardController lifetime; fresh construction is required for StrictMode replay and disposal. |
| `PaneContextActions.tsx`    | `react/refs`                          | Render-prop handlers access refs on subsequent pointer/click events, not during render.                              |
| `buildInfo.ts`              | `unicorn/no-typeof-undefined`         | Vite replacement identifier is undeclared in non-Vite consumers; direct comparison throws.                           |
| `AppErrorBoundary.tsx`      | `no-console`                          | React's native error boundary must preserve original error/component stack diagnostics.                              |
| `tools/design/branding.mjs` | `unicorn/consistent-function-scoping` | Playwright serializes only the evaluate callback; module-scoped image/canvas helper is absent in that browser realm. |

## Validation evidence

Evidence is preserved locally in `/tmp`; these are logs, not repository inputs.

- Fresh `npm ci`: `/tmp/cf-final-ci.log`; successful install, with npm's existing
  install-script approval notices (no approvals or lifecycle policy changed).
- Full fresh `VITEST_MAX_WORKERS=2 npm run check`:
  `/tmp/cf-owned-check.log`, exit **0** in `/tmp/cf-owned-check.exit`.
  Includes formatting, lint, Knip normal/production, app/server/test TypeScript,
  **127 test files / 1,456 tests**, Chromium/WebKit integration and production
  app/service-worker/server build. Browser/artifact/build writers were serialized.
- Separate final `npm run lint`: `/tmp/cf-final-lint.log`, exit 0.
  Full JSON inventory also independently passes.
- Temporary JSX/server/extension-test probes: `/tmp/cf-final-probes.json`.
  JSX async event attribute reports `no-misused-promises`; both server and test
  floating promises report `no-floating-promises`. All three probes were removed
  before the final zero-diagnostic inventory. Compiler checking remains separate.
- `git diff --check` passes. Knip emits only redundant-configuration hints;
  Vite emits chunk-size/deprecation warnings, not errors.

Original clean checkout/install evidence is retained at
`/tmp/fernblick-cf-baseline-original` and `/tmp/fernblick-cf-original-*`.
Original lint passed with warnings. An unconstrained original check encountered
an upload-test timeout; the isolated original rerun with two workers passed
121 files / 1,425 tests, and original build passed separately. This is not used
as a waiver for any final failure. A transient ECONNRESET during intermediate
extension validation was not accepted as success; the full final run passes.

## Fair lint overhead

Same Node/host, separate original installed checkout versus migrated checkout,
complete `npm run lint` (CSS/font guard + Oxlint + Stylelint), alternating three
sequential warm runs, no simultaneous task browser/build/check process:

| Run | Original seconds | Migrated seconds |
| --- | ---------------: | ---------------: |
| 1   |            5.712 |            7.536 |
| 2   |            5.470 |            8.217 |
| 3   |            5.913 |            7.248 |

Median 5.712 → 7.536 seconds: +1.824 seconds, approximately +32%.
This measures the complete migration and additional checks on changed source,
not isolated engine speed. Shared-host load/cache effects remain; no speedup is
claimed. Raw evidence: `/tmp/cf-fair-valid-timings.log` and per-run logs.

## Review and provenance

Two fresh independent local read-only Pi processes review the complete exact
base-to-committed-tip diff, not just the last fixture changes: Standards and
Spec/behavior/coverage. Final review outcomes and exact endpoint are reported in
the handoff; review output is kept outside the source tree until evaluated.
No remote reviews or GitHub operations are authorized.

The exclusive-writer chain preserved earlier commits. The earlier coordinator's
timeout inference was incorrect; the original writer relinquished ownership.
Reconciliation commit `7afb712` preserves both the compare reporter alias and
board-route fixtures. This audit records that provenance, not a claim that all
possible historical overlap effects were exhaustively ruled out. Final full
validation and full-range independent review are the acceptance gates.
