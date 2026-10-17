# Changelog

All notable changes to `dsh-latex-studio`. Versioning follows semver; in the 0.x
range a breaking change moves the MINOR number.

## 0.4.0 — 2026-10-16

Move the configuration into the Plugins page. The plugin now ships a browser half,
so the 17 fields are editable in the GUI instead of only in a profile patch — and
saving applies live, without a restart.

### Added

- **`lib/client.js` — the browser half.** One self-contained file in the client
  module system's lazy-CJS factory format (`window.__ModuleLoader__.load({id, factory})`)
  that `require`s React and nothing else: no bundler, no build step, no runtime
  dependency. It renders six cards (编译链 / 页图渲染 / PDF 读取与隐私 / VTO 版面循环 /
  命令系统 / 可选检查) with switches, selects, a segmented control, checkbox groups
  and drafts committed on Enter/blur — never per keystroke, because every write is a
  validated Host mutation that rewrites the profile patch.
- **Registered on both config surfaces**: `plugins.bundle.config` keyed by the package
  name (the bundle's own config area) and `plugins.row.config` keyed
  `dsh-latex-studio#latex-studio` (the component page, so clicking the row is not a
  dead end). A `summary` render gives the row a one-line description.
- **`locale/en.json` + `locale/zh.json` display metadata** and **`icon.svg`**, so the
  plugin card shows a real title, description and artwork instead of the raw package
  name and the default illustration.
- **`npm run preview`** (`tools/build-preview.mjs`) renders this page as a
  self-contained static HTML file from the same `preview-dict` / `preview-model` /
  `preview-css` regions the bundle ships — a design review without a restart, and it
  cannot drift into fiction because it is generated from the shipped source.
- **`test/client.test.mjs`** — 11 tests that execute the real bundle inside a minimal
  React/DOM shim: loader format, `react`-only requires, both slot keys, model ≡ schema
  fields, every dictionary key present in zh and en, the three degradation paths, and
  the write path (`form.set` / `form.unset` / one atomic `form.mutate` for
  "restore all defaults").
- **`npm run verify:package`** (`tools/verify-package.mjs`) — the release gate that
  `doctor` cannot be: it packs a real tarball, asserts the file whitelist (no `docs/`,
  no `tools/_p0/`, no `node_modules`), the required entries, every `exports` target,
  the `dsh.bundle` / `dsh.client` manifests, the icon and locale metadata, zero runtime
  dependencies, then extracts the tarball and actually `import`s the shipped host half
  (10 tools, 3 skills) and inspects the shipped browser half. It prints the size and
  sha256 of the artifact it verified.
- `tools/doctor.mjs` now checks the browser half (declaration, export, factory format,
  requires, slot keys, locale metadata), and its file list grew by four entries.

### Changed

- **All 17 config fields are now `.volatile()`** — the settings service only projects
  volatile fields into an editable form, so without this the page would have nothing
  to edit.
- **`apply` reads config through `liveConfig(ctx, entryConfig)`** (`lib/config.js`)
  instead of a one-shot `normalizeConfig` snapshot. Volatile fields arrive as
  references; `liveConfig` re-reads `ctx.fiber?.config` on every property access, so a
  saved edit is visible to the next tool call. A snapshot read would have made every
  save succeed silently and change nothing.
- The settings service is told this plugin owns its page
  (`settings.configure({ auto: false }, ctx.fiber)`, inside an optional
  `ctx.inject(['settings'], …)` child). It changes page presentation only; a host
  without the service still loads the plugin.
- `package.json` gains `dsh.client`, `exports["./client"]`, `exports["./package.json"]`,
  `exports["./locale/*.json"]` and the `icon` field.
- README §3 no longer claims `latexmk` is ignored by `latexCommand` (stale since
  0.3.0) and no longer says the B line has 5 tools (it has 6).

### Known at release

- `enableDaily` / `enableVto` remain **load-time** decisions: they change which tools
  `apply` registers, so saving them needs a plugin reload. The card carries an
  explicit「重载后生效」badge instead of pretending otherwise.
- **`.volatile()` is capability-probed** (`markVolatile` in `lib/config.js`,
  `VOLATILE_CONFIG_SUPPORTED` in `lib/index.js`), because not every Schemastery copy a
  host may resolve has `Schema.prototype.volatile`: measured on this machine the DSH
  app's copy does, while the profile-level `@deepseek-ai/schemastery` symlink points at
  a stale global `dsh` install that does not. Calling it unconditionally made the whole
  plugin fail to import there (`...volatile is not a function`). Now the plugin always
  loads; only the form degrades to read-only, and `doctor` reports which case applies
  (`volatile` line) plus a load-time warning naming the cause.
- The browser half has shim-level tests only. Adding `dsh.client` to a package is
  cached per specifier until the Host process restarts, so the live page has not been
  clicked through yet at release time; `docs/DEVELOPMENT.md` §11 keeps that debt and
  §12.2 lists the checks to run after a restart.

## 0.3.0 — 2026-10-11

Cut the parts that only looked load-bearing. Three of the four cuts below were
confirmed by reproducing them first (see each item).

### Breaking

- **Removed `lib/core/voidetect.js`** (~500 lines of PNG/Otsu/projection image
  analysis). It only ever informed 1 of the 18 defect classes, its own contract
  said the page image remains the arbiter, and its trailing-whitespace metric was
  measuring the wrong thing: on the demo, a full page and a nearly empty page both
  reported 0.1705, because the page number is the lowest ink on both. Removing it
  changes no decision — the judgement is, and was, the page image plus the checklist.
  `vto_inspect` no longer returns `machineSignals`.
- **`vto_report` no longer takes `defectsBefore`/`defectsAfter`** and no longer
  renders a template: the elimination-progress table is computed from the ledger,
  so it can no longer disagree with the ledger table above it.
- **`vto_inspect` no longer prints taxonomy self-check warnings** (`routingWarnings`):
  every one of them pointed at a PaperFit skill that 0.2.0 had already stopped
  registering — noise addressed to the model on every call.
- The report template `lib/data/diagnostic_report.template.md` is gone; the report
  is generated directly (no placeholders, no fallback template).

### Added

- **`vto_rollback({dir, round})` — rollback is now an action, not advice.** Every
  `vto_fix({apply:true})` already wrote `backups/r<n>/`, and `vto_verify` returned
  `rollbackTo`, but nothing could execute it; the caller had to copy files back by
  hand. The new tool performs it from the manifest and refuses when there is none.

### Fixed

- The report printed its ledger header twice (template header + generated header)
  and its progress table was all zeros (fed from model-typed arguments instead of
  the ledger).
- The compile-driver story was inconsistent in three places the model actually
  reads — the `latex_build` tool description, `skills/latex-vto-loop`, and
  `docs/INTERFACES.md` all still said "latexmk 不可用" while 0.2.0 both detected
  and preferred it. All normative text now says: use latexmk when Perl is present,
  otherwise fall back to the built-in multi-pass driver.
- `docs/HANDOFF.md`, `docs/ACCEPTANCE.md`, `lib/core/compile.js`, `lib/core/env.js`
  and `lib/config.js` carried the same stale claim (the supersession is recorded in
  `docs/DEVELOPMENT.md` §13, which replaced the old probe report).

### Docs

- New `README` §2.6 "环境要求与自助安装": the one hard dependency (MiKTeX), the
  optional ones (Perl+latexmk, chktex, MinerU), what breaks without each, the exact
  install command, and the self-install loop the model should run (`latex_doctor` →
  run the advice commands → `latex_doctor({refresh:true})` → report what is still
  missing instead of pretending).
- New `docs/README.md` index that marks which documents are current and which are
  history, plus naming rules (this plugin's names, no volatile numbers).

## 0.2.0 — 2026-10-11


The "make the assets load-bearing" release: the previously decorative PaperFit
material now has consumers, the tool parameters have one documented basis, and
the loop keeps a defect ledger across rounds.

### Breaking

- **Skills: 11 → 3.** The eight vendored `paperfit-*` skills are no longer
  registered. They described a foreign workflow (its own agent roles,
  `data/pages/`, 220 DPI, `/check-visual`) and, being frozen byte-identical,
  could not be adapted. Upstream prose stays in `docs/upstream/paperfit/` as
  read-only reference and `docs/` is no longer published. The operating knowledge
  is this package's own `skills/latex-*`.
- **Path parameters have one basis (and the docs now say which).** `dir`, `bib`,
  `tex` and `latex_doctor.pdfPath` are workspace-relative; `entry`, `file` and
  `pdf` are relative to `dir`; `workDir` is a plain directory name. Passing a
  path on the wrong basis now returns an actionable message instead of
  `FILE_NOT_READABLE`.
- **`state.json` v2** adds `ledger`. v1 files stay readable (a missing ledger is
  treated as empty); no migration step is required.
- **Compile driver default.** `latexmk` is preferred whenever it can actually run
  (it needs Perl, which MiKTeX does not ship); otherwise the built-in multi-pass
  driver is used. Results carry `via` and `stopReason`. An explicitly requested
  `engine` still bypasses latexmk.
- **Removed:** `skills/paperfit-*`, `tools/install-skills.mjs`,
  `lib/data/_meta.json`, `tools/convert-yaml.mjs`; `docs/` leaves the published
  file set.

### Added

- **Defect ledger** (`state.json.ledger`): `vto_report({defects:[…]})` upserts by
  `id+page`, `vto_inspect` returns it, and `vto_verify` fails on a
  `fixed → open` regression, downgrading the verdict when gate-blocking defects
  stay open. This is the mechanism PaperFit's gain is attributed to.
- **Checklist carries the taxonomy fields that matter:** `visual_indicators`
  (how to see it on the page), `log_signals`, `semantic_constraints`,
  `gate_blocking`, and the manual pointer. `auditTaxonomy()` cross-checks the
  taxonomy's two routing copies, its inline thresholds and `agent_roles.routing`.
- **The four previously-unread data files now have consumers:**
  `templates.json` (→ `vto_start({template})`: column type, expected pages,
  package rules), `writing_rules.json` (→ semantic caps surfaced by
  `vto_inspect` and enforced in the `vto_fix` pre-check),
  `content_boundaries.json` (→ `checks.contentBoundaries`), `agent_roles.json`
  (→ routing audit).
- **Structured parse is real.** `vto_inspect({parse:true})` calls
  `read_pdf({view:'content'})` — but only after `uploadScope` allows it; without
  `consent` on a user manuscript the provider is never contacted.
- **Driver reporting:** `via` (`latexmk` | `builtin`), `stopReason`
  (`stable`/`rerun`/`errors`/`max-passes`/`timeout`/`latexmk`), and `makeindex`
  support in the built-in driver (an index was silently dropped before).
- **`lib/core/rules.js`**: one FORBIDDEN table and one `extractProtected`, shared
  by `policy.js`, `guard.js` and `lint.js` (previously two of each).

### Fixed

- Path handling: `vto_fix.file`, `vto_start.entry` and the `pdf` arguments used
  to be containment-checked against `process.cwd()` while being joined onto the
  project directory — the checked tree and the written tree differed.
- The report no longer claims "未编译" for a successful build, no longer fills a
  "content hash" with a timestamp, and no longer contains sections addressed to
  agent roles that do not exist.
- `latex_doctor.refresh` now clears the executable-resolution cache (it was a
  documented no-op).
- `pdfinfo` output is decoded defensively (`decodeToolOutput`): MiKTeX's build
  emits UTF-16LE with a BOM for file/console handles and renders the localized
  timezone in the ANSI codepage for pipes.
- `guard.js` secret patterns had two double-escaped regexes (`\\s` instead of
  `\s`).
- README contradicted itself about whether skills need an install step.

### Known limitations (unchanged or newly explicit)

- Windows + MiKTeX is the verified platform; `latexmk` needs Perl.
- `content_boundaries` minima are advisory (`warn` → `pass_with_notes`), not a
  hard gate: they are PaperFit's defaults for full papers.
- `lib/data/` retains two threshold copies inside the vendored taxonomy; they are
  audited by `auditTaxonomy()` and reported on drift rather than rewritten.
- `vto_fix` still performs literal find/replace; the host `edit` tool remains the
  version-guarded alternative for hand edits.

## 0.1.0 — 2026-10-10

Initial two-line plugin (daily compile + VTO loop), 9 tools and 11 registered
skills, guard/policy/backup/rollback, local page rendering via Poppler/Ghostscript.

## Rollback (0.2.0 → 0.1.0)

The upgrade is reversible without touching the repository history:

1. Restore the profile manifest from the backup snapshot:
   copy `<backup>/profile-package.json.snapshot` over
   `$DSH_HOME/profiles/<profile>/package.json`.
2. Restore the installed copy: copy `<backup>/installed-copy` over
   `$DSH_HOME/profiles/<profile>/node_modules/dsh-latex-studio`.
3. Restart DSH, then verify:
   `node tools/doctor.mjs --dir <restored copy>` must print `verdict: HEALTHY`.

Backups created by the 0.2.0 work live under
`$USERPROFILE/.dsh/backups/latex-studio/<version>-<timestamp>/` with a
`MANIFEST.json` (per-file sha256) and a verified restore log. The 0.1.0 source
archive and the published `dsh-latex-studio-0.1.0.tgz` are kept there because the
profile's dependency spec points at the tgz inside this repository.
