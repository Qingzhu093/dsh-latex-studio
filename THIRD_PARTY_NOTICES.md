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

Re-implemented (not copied): `lib/core/voidetect.js` is a behaviour-equivalent port of
`scripts/detect_column_void.py` (page-image column-void detection, algorithm reference lines
149-243: Otsu ink threshold, row-wise ink projection with moving average, void segmentation and
merging, gutter search, Sobel line-height estimation, `a5_candidates` output). The upstream script
requires `opencv-python-headless` + `numpy`; this port uses only Node built-ins (`zlib`) because the
package keeps `dependencies: {}`. One intentional semantic difference is documented in the module:
the upstream script always splits the page into two columns, whereas this port abstains from void
detection for single-column layouts (A5 is defined for two-column layouts only).

Methodology reference: PaperFit, arXiv:2605.10341, UCAS / Shanghai AI Laboratory / SJTU.

**Vendored specification text** (added 2026-10-11): the agent and skill specification prose from
`paperfit-cli@1.0.6` is vendored as data assets, because these files are the paper-level reference
for VTO repair and were previously paraphrased from memory in this package:

- `docs/upstream/paperfit/agents/*.md` — 6 agent specifications (orchestrator, rule-engine,
  layout-detective, code-surgeon, semantic-polish, quality-gatekeeper), byte-identical to upstream.
- `skills/paperfit-*/SKILL.md` — 8 fixer/inspection skills. The ONLY modification is a prepended
  YAML frontmatter block (`name` + `description`, mechanically derived from the upstream title and
  opening paragraph) that the DSH skill provider requires; upstream ships no frontmatter, so no
  upstream content is replaced. Directories are prefixed `paperfit-` so they can never collide with
  this package's own `latex-*` skills in a shared discovery root.
- `docs/upstream/paperfit/CLAUDE.md`, `commands/*.md`, `LICENSE` — byte-identical to upstream.

Provenance, per-file source hashes and the upstream version are recorded in
`docs/upstream/paperfit/MANIFEST.json`, written by `tools/vendor-paperfit-specs.mjs`
(`npm run vendor-specs -- --from <paperfit-cli-dir>`; `--check` fails on drift).
Note: `skills/latex_fixers/` (Python) is deliberately NOT vendored — it is implementation, not
specification, and this package keeps `dependencies: {}`.

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