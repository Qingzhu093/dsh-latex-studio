# Changelog

All notable changes to `dsh-latex-studio`. Versioning follows semver; in the 0.x
range a breaking change moves the MINOR number.

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
