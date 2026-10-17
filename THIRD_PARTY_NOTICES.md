# Third-party notices

This package vendors data and knowledge derived from the following MIT-licensed projects.
Their code/config is used under the MIT License; the original license text is reproduced below.

## PaperFit (https://github.com/OpenRaiser/PaperFit) — MIT
Vendored: `config/vto_taxonomy.yaml`, `config/layout_rules.yaml`, `config/content_boundaries.yaml`,
`config/templates.yaml`, `config/writing_rules.yaml`, `config/agent_roles.yaml`,
`config/diagnostic_report.template.md`
(converted **once** to JSON under `lib/data/` while porting; the one-off converter and the upstream
YAML are no longer part of this repository — the JSON under `lib/data/` is the only form of this data
here, and the provenance above plus `docs/upstream/paperfit/MANIFEST.json` is the record of origin).

Historical (removed in 0.3.0): `lib/core/voidetect.js` was a behaviour-equivalent port of
`scripts/detect_column_void.py`. It was deleted because its only contribution was a trailing-blank
metric that measured the wrong thing; no vendored code from that port remains in this package.

Methodology reference: PaperFit, arXiv:2605.10341, UCAS / Shanghai AI Laboratory / SJTU.

**Vendored specification text — reference only (posture changed in 0.2.0)**: the agent and command
specification prose from `paperfit-cli@1.0.6` is vendored under `docs/upstream/paperfit/` so a reader
can consult the original wording:

- `docs/upstream/paperfit/agents/*.md` — 6 agent specifications (orchestrator, rule-engine,
  layout-detective, code-surgeon, semantic-polish, quality-gatekeeper), byte-identical to upstream.
- `docs/upstream/paperfit/CLAUDE.md`, `commands/*.md`, `LICENSE` — byte-identical to upstream.

Until 0.2.0 the upstream skill texts were also shipped as eight `paperfit-*` DSH skills. That is no
longer the case: registering them made the model read a foreign workflow (its own agent roles,
`data/pages/`, 220 DPI, `/check-visual`) as this plugin's operating manual, and freezing them
byte-identical ruled out the adaptations this package needs. Operational knowledge now lives in this
package's own `skills/latex-*`, which we own; `docs/` is not part of the published file set.

Provenance, per-file source hashes and the upstream version are recorded in
`docs/upstream/paperfit/MANIFEST.json`, written by `tools/vendor-paperfit-specs.mjs`
(`npm run vendor-specs -- --from <paperfit-cli-dir>`; `--check` fails on drift).
Note: `skills/latex_fixers/` (Python) is deliberately NOT vendored — it is implementation, not
specification, and this package keeps `dependencies: {}`.

## @deepseek-ai/schemastery + @deepseek-ai/cosmokit (DeepSeek Harness / Shigma) — MIT
Vendored verbatim under `lib/vendor/schemastery.mjs`, `lib/vendor/cosmokit.mjs` and
`lib/vendor/LICENSE`, extracted from the DeepSeek Harness 0.2.1-rc.2 desktop runtime
(`schemastery` 3.18.4, `cosmokit` 1.8.5). Exactly one edit was applied: the schema module's
`@deepseek-ai/cosmokit` import is rewritten to the sibling `./cosmokit.mjs`, so the bundled copy
stays self-contained.

Reason: the DSH settings service only projects **volatile** config fields into an editable form, and
`Schema.prototype.volatile` does not exist in every `@deepseek-ai/schemastery` copy a host may
resolve. Measured case: a profile-level peer tree left behind by an old global DSH install resolved
3.18.2, which has no volatile support — the plugin's configuration page was permanently read-only
there. `selectSchema()` in `lib/index.js` uses the host copy when it supports volatile (the normal
case, keeping schema envelopes in sync with the running host) and this bundled copy otherwise.
Volatile references stay interoperable across copies because cosmokit identifies them with
`Symbol.for("cosmokit.volatile.write")`.

## dsh-latex-guard (https://github.com/Flan246/dsh-latex-guard) — MIT
Re-implemented (not copied): the BibTeX parse / lint / fill / cite-audit behaviour and the
'refuse to write an unparseable .bib' safety rule.

---

MIT License

MIT License

Copyright (c) 2026 PaperFit

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.