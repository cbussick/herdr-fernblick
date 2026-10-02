# HER-5: Pi skill discovery and invocation

## Evidence and version boundary

Static research only: no models, tests, servers, package resolution/installation, or Linear operations were run.

- **Authoritative target: `@earendil-works/pi-coding-agent` 0.99.1**, verified in `node_modules/@earendil-works/pi-coding-agent/package.json:3`. Below, **C/** means that package's `dist/` directory; **PM** means `C/core/package-manager.js`; **AS** means `C/core/agent-session.js`.
- The requested global documentation is actually installed with **1.0.0**, not 0.99.1 (`/root/.nvm/versions/node/v24.18.0/lib/node_modules/@earendil-works/pi-coding-agent/package.json:3`). **D/** means its `docs/` directory. Read completely: `skills.md`, `extensions.md`, `packages.md`, `settings.md`, `configuration.md`, `security.md`, `cli.md`, `sdk.md`, `prompt-templates.md`, `environment-variables.md`, and `tui.md`; also the global `examples/extensions/{commands,send-user-message}.ts` and `examples/sdk/04-skills.ts`. Use these as guidance, not a substitute for the installed target's implementation.

## Recommendation

**Ask the extension in the selected live Pi session for `pi.getCommands().filter(c => c.source === "skill")`; invoke a freshly validated command with `pi.sendUserMessage(content, { expandPromptTemplates: true })`.** Do not scan Fernblick's filesystem, reimplement Pi discovery, or create another Pi/model session. Keep normal chat expansion off. This preserves that agent's actual trust, filters, CLI choices, package resolution, collision winners, and custom resource-loader decisions. [AS:2613–2633, 1780–1807]

## Discovery: exact default-loader behavior

`agentDir` defaults to `~/.pi/agent`; `PI_CODING_AGENT_DIR` or SDK `agentDir` can change it. Home `.agents` remains separate from that setting. Project `.pi` is under the **session working directory**, not automatically the repository root. [C/config.js:443–453; C/core/sdk.js:68–80; PM:1998–2026]

Normal precedence, highest first (different files with the same skill name):

| Order | Source                                                                                             |
| ----- | -------------------------------------------------------------------------------------------------- |
| 1     | Skills supplied by explicit CLI `-e` packages/directories                                          |
| 2     | Project `skills` settings paths, relative to `cwd/.pi`                                             |
| 3     | Auto `cwd/.pi/skills`, then `cwd/.agents/skills`, then ancestor `.agents/skills` nearest first     |
| 4     | User `skills` settings paths, relative to `agentDir`                                               |
| 5     | Auto `agentDir/skills`, then `~/.agents/skills`                                                    |
| 6     | Configured package skills: project packages before user packages, preserving package-list order    |
| 7     | Explicit `--skill` paths / SDK `additionalSkillPaths` (appended, **not overriding** earlier names) |

Project rows require trust. Ancestor `.agents/skills` discovery stops at the nearest directory containing `.git` (file or directory), inclusive; without one, it reaches filesystem root. It excludes the user `~/.agents/skills` location from the project list. Parent `.pi/skills` directories are **not** searched. [PM:278–310, 2023–2064]

Precedence comes from package-manager ranking plus resource-loader concatenation, **not** merely directory order. Equal-rank resources retain discovery order. Exact paths enter the package accumulator first-wins before ranking; canonical-path duplicates are then removed (including disabled entries), and skill loading keeps the first name with a collision diagnostic, silently dropping repeated real files. Consequently, overlapping declarations/symlinks can affect both enabled state and provenance. [PM:50–70, 704–734, 2099–2138; C/core/resource-loader.js:383–421, 781–792; C/core/skills.js:312–347]

**Traversal and validation:**

- A directory containing an unignored `SKILL.md` is a skill root: stop there, even if its metadata is invalid. Otherwise recurse. Pi-style roots also consider direct root `.md` files, but not arbitrary nested `.md` files. Auto `.agents` discovery instead considers non-root `.md` files and excludes root standalone Markdown. This `.agents` permissiveness is an implementation detail, not a portable format. [PM:207–276; C/core/skills.js:124–206]
- Hidden entries and `node_modules` are skipped during traversal; symlinks are followed; broken ones skipped. `.gitignore`, `.ignore`, and `.fdignore` rules are read from each scanned directory, starting at the scan root (not all repository ancestors). Explicit files/roots can bypass ordinary discovery exclusions. Package globs omit dot-path matches; exact manifest paths can target dot/symlink roots. [PM:77–151, 207–270, 1960–1985; C/core/skills.js:12–55, 369–388]
- Parsed skills need a nonempty string `description`. Malformed frontmatter is skipped; malformed declared `SKILL.md` gets a warning. Name defaults to the parent directory; invalid names and oversized descriptions warn but still load. There is no name/directory-match requirement. Supporting Markdown without a description is skipped. [C/core/skills.js:208–265]
- `disable-model-invocation: true` suppresses only system-prompt advertising, **not loading, listing, or explicit invocation**. [C/core/skills.js:257–278; AS:1597–1610, 2626–2632]

### Settings, filters, packages, and CLI

Both scopes' resource lists are processed independently; don't reconstruct a catalog from `pi.getSettings().skills` (ordinary settings-array merging replaces arrays, whereas package resolution reads both scope lists). Absolute and `~` paths are supported. [C/core/settings-manager.js:16–32, 303–312; PM:704–734, 1832–1846]

- Top-level `skills` plain entries discover files/directories; patterns filter those candidates. Bare glob entries here are **not filesystem glob discovery**. Auto-discovered resources use only override patterns from their own scope's settings. `!pattern` excludes by glob; `+path` restores an exact path; `-path` excludes an exact path last. This precedence is independent of array order. Matching also recognizes a `SKILL.md` file's parent directory; exact matching uses relative/absolute paths rather than arbitrary basename matching. `+path` alone does not discover a new resource. [PM:476–592, 1970–1985, 2028–2064]
- Packages support npm, git/URL, and local sources. `pi install` persists user declarations; `--local` uses project settings. Local paths resolve relative to their declaring scope, without copying. Manifest `pi.skills` entries are relative to package root and support actual glob discovery; absent a manifest, conventional `skills/` discovery applies. [D/packages.md:9–71; PM:999–1098, 1848–1895, 1960–1968]
- Package-object `skills` omitted uses defaults; `[]` disables that type; nonempty filters narrow discovered candidates with include, `!`, `+`, and `-` rules. Nonempty manifest exclusions cannot be re-enabled through a settings filter. Project package identity overrides user identity (npm name, git host/path without ref, resolved local path); project `autoload: false` instead supplies a sparse, ordered filtering delta over the user package. [PM:553–606, 1059–1065, 1390–1433, 1848–1947]
- **0.99.1 manifest caveat:** a plain package with a manifest uses only its declared entries, but an object-filtered package can fall back to conventional directories when manifest entries are absent/empty (`collectDefaultResources`, `collectManifestFiles`). Thus the docs' “filters only narrow the manifest” is not unconditional for empty/omitted entries. [PM:1865–1947]
- `--skill` is repeatable and resolves from `cwd`; `--no-skills` drops ordinary configured/discovered skills but retains explicit `--skill` **and skills from explicit `-e` sources**. `--no-extensions` is a separate switch, not a skill-disable switch. [C/cli/args.js:152–155, 174–175; C/main.js:578, 624–628; C/core/resource-loader.js:399–421]
- Extension `resources_discover` results append more skill paths, even with `noSkills`; SDK `skillsOverride` or a custom loader can replace/filter the result. The standalone SDK `loadSkills({includeDefaults:true})` only searches user `.pi` then project `.pi` plus supplied paths: it is **not** the full, trust-aware default-loader pipeline. [C/core/resource-loader.js:317–333, 619–640; C/core/skills.js:348–388]

### Trust

CLI resolution: explicit `--approve`/`--no-approve` → no protected resources means trusted → first deciding pre-trust extension → nearest saved cwd/ancestor decision in `agentDir/trust.json` → global `defaultProjectTrust` (`ask` default). Without interactive UI, unresolved `ask` declines. Project settings/packages and auto project skill locations are omitted when untrusted; personal and explicit CLI sources remain available. Trust is a loading decision, not a sandbox. [C/core/project-trust.js:17–57; C/core/trust-manager.js:18–33, 151–175; C/core/resource-loader.js:343–364; C/core/settings-manager.js:233–236, 317–334, 742–745; PM:2023–2064; D/security.md:29–91]

Two subtleties: trust _detection_ checks `.agents/skills` ancestors to filesystem root even though discovery stops at the repository root; and raw SDK `SettingsManager.create()` defaults to trusted, with `createAgentSession()` doing no CLI trust negotiation. An extension must report its host session's result, not assume CLI defaults or evaluate trust itself. [C/core/trust-manager.js:151–169; PM:278–310; C/core/settings-manager.js:213–224; C/core/sdk.js:68–80]

## Extension listing and invocation contracts

`getCommands(): SlashCommandInfo[]` returns extension commands, prompt templates, then **every currently loaded skill**, with `name: "skill:<name>"`, optional `description`, `source: "skill"`, and `sourceInfo: {path, source, scope, origin, baseDir?}`. There is no leading `/`. It does not expose skill body, diagnostics, `disableModelInvocation`, or a guaranteed skill-directory `baseDir` (provenance base is different). Built-in slash commands are not included. [C/core/slash-commands.d.ts:1–8; C/core/source-info.d.ts:2–10; AS:2613–2633]

Call it on demand after runtime binding, not in the extension factory. In particular, `session_start` happens **before** extension `resources_discover`; caching only at session start misses those additions. Reload/session changes invalidate earlier assumptions. [C/core/extensions/loader.js:107–130; AS:2549–2568]

**`enableSkillCommands` defaults to true but gates only interactive autocomplete registration.** False does not suppress `getCommands()`, system-prompt skill advertising, or manual/programmatic `/skill:name` expansion. Do not treat it as an authorization switch. A Fernblick choice to hide its picker would be additional UI policy, not Pi's loaded-skill behavior. [C/core/settings-manager.js:877–883; C/modes/interactive/interactive-mode.js:506–520; AS:1597–1610, 2626–2632; D/skills.md:54]

Minimal invocation shape (after validation; `images` are structured image blocks):

```ts
const command = pi.getCommands().find((c) => c.source === "skill" && c.name === selectedName);
if (!command) throw new Error("Skill no longer available");
const text = `/${command.name}${args ? ` ${args}` : ""}`;
pi.sendUserMessage([{ type: "text", text }, ...images], {
  expandPromptTemplates: true,
  // deliverAs: "followUp" // or "steer", if deliberately accepting busy-agent input
});
```

- **Expansion defaults to false on `sendUserMessage`**, unlike `session.prompt`. Explicit true enables extension-command dispatch **as well as** skill/template expansion; never enable it for arbitrary chat just to support a picker. [C/core/extensions/types.d.ts:1212–1220; AS:1449–1480, 1773–1807]
- Pi recognizes `/skill:` only at position zero and splits at the first literal ASCII space, not general whitespace. Use one text block with a space before arguments (which may contain newlines); multiple text blocks are joined with `\n`, which can accidentally become part of the command name. [AS:1597–1603, 1780–1800]
- Expansion re-reads the loaded skill's file, strips frontmatter, wraps its body in `<skill name="…" location="…">` with a relative-reference directory hint, and appends trimmed arguments. It does not execute the file as a script or interpolate arguments into the body. Unknown skills pass through literally; read failure emits `skill_expansion` and also passes through literally. Revalidate against the live catalog, but recognize the remaining file/reload race. [AS:1597–1620]
- An extension command with the same invocation name runs **before** skill expansion. Reject/disable such shadowed entries for deterministic skill selection. Prompt templates run _after_ successful skill expansion and therefore do not normally shadow a loaded skill. Input hooks can consume or transform input before expansion; `source` is `"extension"`. [AS:1449–1480, 1567–1589, 1801–1806]
- `pi.sendUserMessage` returns **void**, not a completion promise. The runtime catches asynchronous failures and emits `send_user_message` errors. A bridge acknowledgement means submitted, not successfully expanded/run/completed. Busy streaming input requires `deliverAs: "steer" | "followUp"`; compaction rejects prompting. [AS:1466–1468, 1482–1494, 2644–2651; C/core/extensions/types.d.ts:1217–1220]

### Images

Preserve `{type:"image", data:<base64>, mimeType:<string>}` blocks alongside the command text; do not serialize them into the prompt or discard them while adding the command. `sendUserMessage` separates images from joined text, expands text, and forwards both to the normal user-message path; original text/image interleaving is not retained. [AS:1780–1807; `node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/types.d.ts:275–279`]

Idle prompting normalizes/resizes images according to settings and selected model limits, adds conversion/omission hints, and keeps successful images. The streaming queue branches bypass this idle normalization and append images directly, so don't promise identical preprocessing for queued attachments. `images.blockImages` dynamically replaces images with text placeholders on model conversion; accepting an image is not proof that the model saw it. Skill Markdown image references do not automatically become attachments. [AS:1421–1438, 1482–1495, 1520–1541, 1665–1688; C/core/sdk.js:149–179; AS:1607–1610]

## Scope and limitations for HER-5

Use a per-agent live catalog; distinguish unavailable/disconnected from an empty catalog. Retain source metadata for explanations, not as permission to read arbitrary backend files. Re-fetch at selection/submission, account for command shadowing and warning-only invalid skill names, and leave non-skill messages literal. Do not promise diagnostics, exactly-once execution, model compliance, or file-read success from these two extension APIs. Pin/recheck these contracts when updating Pi, especially because the available global documentation is newer than the target.
