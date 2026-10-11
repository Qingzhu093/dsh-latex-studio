/**
 * Single source of truth for the LaTeX rule tables.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Before 0.2.0 the same knowledge lived in two places with different semantics:
 *  - lib/core/policy.js held the five FORBIDDEN pseudo-fix patterns and gated
 *    *newly added* occurrences (a diff gate used by vto_fix);
 *  - lib/core/lint.js held four rules of its own (no-resizebox, bare-vspace,
 *    tiny-font, excess-newpage) with separate regexes, and the two already
 *    disagreed (lint needs more than three newpage hits; policy has a
 *    scriptsize rule lint never had).
 *
 * The protected-content extractor was duplicated the same way: guard.js had the
 * rich one (captions, numeric counts, table cells) while lint.js had a smaller
 * variant with different regexes. Two implementations of a safety boundary
 * drift; lib/core/paths.js documents that lesson for path guards and this module
 * applies it to rules.
 *
 * policy.js, guard.js and lint.js all re-export from here, so their public
 * surfaces (and every test that imports them) are unchanged.
 *
 * Both blocks below are the pre-0.2.0 implementations moved verbatim (git c92a50d).
 *
 * Pure Node ESM - no DSH imports.
 * @module dsh-latex-studio/core/rules
 */
import { createHash } from 'node:crypto'

/**
 * The forbidden-practice rules.
 *
 * Each rule: `{ id, name, severity, pattern, message, hint, newAllowed }`.
 * `newAllowed` is how many *newly added* matches are tolerated (0 = any new
 * occurrence is a violation).
 */
export const FORBIDDEN = Object.freeze([
  {
    id: 'resizebox',
    name: '禁止 \\resizebox 暴力缩放',
    severity: 'critical',
    newAllowed: 0,
    pattern: /\\resizebox(?![a-zA-Z])\*?/g,
    message: '使用了 \\resizebox 暴力缩放：会连带缩放字号，造成全篇表格字号不一致（C1）与跨模板失真（E1）。',
    hint: '改用 tabularx + \\textwidth 弹性 X 列；图片按 \\linewidth / \\columnwidth 设自然宽度，绝不用 \\resizebox。',
  },
  {
    id: 'bare-vspace',
    name: '裸 \\vspace 硬编码间距',
    severity: 'major',
    newAllowed: 0,
    pattern: /\\vspace(?![a-zA-Z])\*?\s*\{\s*[-+]?(?:\d+(?:\.\d+)?\s*(?:pt|em|ex|cm|mm|in|bp|pc|sp)|\d+(?:\.\d+)?\\baselineskip)\s*\}/g,
    message: '新增了固定尺寸的裸 \\vspace{...}：属于掩盖排版问题的间距 hack，会破坏纵向节奏（A5）。',
    hint: '改用语义化间距（\\setlength{\\parskip}、列表参数、\\captionsetup）或 \\vspace*{\\fill}（允许的填页形式）；确需固定间距请在 diff 中说明理由。',
  },
  {
    id: 'newpage-abuse',
    name: '滥用 \\newpage/\\clearpage',
    severity: 'major',
    newAllowed: 0,
    pattern: /\\(?:newpage|clearpage|cleardoublepage)\b/g,
    message: '新增了强制分页命令：滥用会造成大面积留白与列空洞（A2/A5）。',
    hint: '优先用浮动体参数（[htbp]/[t]）、\\FloatBarrier 或段落伸缩解决；确需在参考文献前强制分页时，请在 diff 中说明并与用户确认。',
  },
  {
    id: 'tiny-font',
    name: '滥用 \\tiny',
    severity: 'major',
    newAllowed: 0,
    pattern: /\\tiny\b/g,
    message: '新增了 \\tiny 缩小字号：会破坏全篇字号一致性（C1）并降低可读性。',
    hint: '表格统一用 \\small 或模板默认字号，通过列宽/断行而不是缩字号解决溢出。',
  },
  {
    id: 'scriptsize-font',
    name: '滥用 \\scriptsize',
    severity: 'major',
    newAllowed: 0,
    pattern: /\\scriptsize\b/g,
    message: '新增了 \\scriptsize 缩小字号：与表格/正文默认字号不一致（C1）。',
    hint: '统一字号策略，优先用 \\small；若整篇模板规定小字号，请在模板层一次性设置而不是逐处加。',
  },
])

/** Look one rule up by id (used by lint to reuse the same patterns). */
export function forbiddenRule(id) {
  return FORBIDDEN.find((rule) => rule.id === id) || null
}

/** sha256 of a text, hex. */
export function hashText(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex')
}

/** 1-based line number of one offset. */
function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

// --- command scanners -------------------------------------------------------
// Each pattern matches only the command token; the braced argument is read by
// captureBalanced() so nested braces (\\(\\cite{a}) and \\{ escapes survive.

const CITE_RE = /\\(cite|citep|citet|citealp|citeauthor|citeyear|citeyearpar|parencite|textcite|autocite|footcite|fullcite|nocite|supercite|shortcite|Cite|Citep|Citet)(?![a-zA-Z])\*?/g
const LABEL_RE = /\\(label|hypertarget)(?![a-zA-Z])\*?/g
const REF_RE = /\\(ref|eqref|autoref|autopageref|pageref|cref|Cref|cpageref|Cpageref|nameref|vref|Vref|fref|Fref)(?![a-zA-Z])\*?/g
const CAPTION_RE = /\\(caption|subcaption|captionof)(?![a-zA-Z])\*?/g
const NUMBER_RE = /(?<![A-Za-z0-9_.])\d+(?:\.\d+)?(?![A-Za-z0-9_])/g

/** Read a balanced `{...}` group starting at `openIdx`, honoring \\{ / \\} escapes. */
function captureBalanced(text, openIdx) {
  if (text[openIdx] !== '{') return null
  let depth = 0
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') { i++; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return { raw: text.slice(openIdx, i + 1), inner: text.slice(openIdx + 1, i) }
    }
  }
  return null
}

/**
 * Collect `{ command, inner, index, line }` for every command matched by `re`
 * that is followed by optional `[...]` arguments and one braced argument.
 * @param {string} text - source text.
 * @param {RegExp} re - command-token pattern with a capture group.
 * @returns {Array<{command: string, inner: string, index: number, line: number}>}
 */
function collectArgs(text, re) {
  const out = []
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  let m
  while ((m = rx.exec(text)) !== null) {
    let i = rx.lastIndex
    let blocked = false
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++
      if (text[i] === '[') {
        const close = text.indexOf(']', i)
        if (close < 0) { blocked = true; break }
        i = close + 1
        continue
      }
      break
    }
    if (blocked) continue
    const captured = captureBalanced(text, i)
    if (!captured) continue
    out.push({ command: m[1], inner: captured.inner, index: m.index, line: lineOf(text, m.index) })
  }
  return out
}

/** Split a comma-separated key list. */
function splitKeys(inner) {
  return String(inner)
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
}

/** Normalize a caption / table row for comparison. */
function normalizeFragment(text) {
  return String(text).replace(/\s+/g, ' ').trim()
}

/**
 * Accept either `[{path, text}]` or `{path: text}`.
 * @param {Array<{path?: string, text?: string}>|Record<string, string>|undefined} texSources - sources.
 * @returns {Array<{path: string, text: string}>} normalized sources.
 */
export function normalizeSources(texSources) {
  if (Array.isArray(texSources)) {
    return texSources
      .filter((s) => s && typeof s === 'object')
      .map((s, i) => ({ path: String(s.path ?? 'source-' + i), text: typeof s.text === 'string' ? s.text : '' }))
  }
  if (texSources && typeof texSources === 'object') {
    return Object.keys(texSources).map((path) => ({ path, text: typeof texSources[path] === 'string' ? texSources[path] : '' }))
  }
  return []
}

/**
 * Extract the protected content set from a set of sources.
 * @param {Array<{path: string, text: string}>|Record<string, string>} texSources - sources.
 * @returns {{cites: string[], labels: string[], refs: string[], captions: string[], numericTokens: string[], numericCounts: Record<string, number>, cells: string[]}}
 */
export function extractProtected(texSources) {
  const sources = normalizeSources(texSources)
  const cites = new Set()
  const labels = new Set()
  const refs = new Set()
  const captions = new Set()
  const cells = new Set()
  const numericCounts = new Map()

  for (const { text } of sources) {
    for (const a of collectArgs(text, CITE_RE)) for (const k of splitKeys(a.inner)) cites.add(k)
    for (const a of collectArgs(text, LABEL_RE)) for (const k of splitKeys(a.inner)) labels.add(k)
    for (const a of collectArgs(text, REF_RE)) for (const k of splitKeys(a.inner)) refs.add(k)
    for (const a of collectArgs(text, CAPTION_RE)) {
      const value = normalizeFragment(a.inner)
      if (value.length > 0) captions.add(value)
    }

    const numRe = new RegExp(NUMBER_RE.source, 'g')
    let n
    while ((n = numRe.exec(text)) !== null) numericCounts.set(n[0], (numericCounts.get(n[0]) || 0) + 1)

    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim()
      if (line.length === 0 || line.startsWith('%')) continue
      if (!line.includes('&')) continue
      cells.add(normalizeFragment(line.replace(/\\s*$/, '')))
    }
  }

  const sortedCounts = {}
  for (const key of [...numericCounts.keys()].sort()) sortedCounts[key] = numericCounts.get(key)

  return {
    cites: [...cites].sort(),
    labels: [...labels].sort(),
    refs: [...refs].sort(),
    captions: [...captions].sort(),
    numericTokens: Object.keys(sortedCounts),
    numericCounts: sortedCounts,
    cells: [...cells].sort(),
  }
}

/**
 * Freeze the current protected set + per-file hashes.
 * @param {Array<{path: string, text: string}>|Record<string, string>} texSources - sources.
 * @returns {{version: number, at: string, protected: object, hashes: Record<string, string>, files: string[]}}
 */
export function snapshot(texSources) {
  const sources = normalizeSources(texSources)
  const hashes = {}
  for (const s of sources) hashes[s.path] = hashText(s.text)
  return {
    version: 1,
    at: new Date().toISOString(),
    protected: extractProtected(sources),
    hashes,
    files: Object.keys(hashes).sort(),
  }
}

/** Which numeric tokens changed between two count maps. */
function diffCounts(before, after) {
  const out = {}
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  for (const key of [...keys].sort()) {
    const b = Number((before || {})[key] || 0)
    const a = Number((after || {})[key] || 0)
    if (a !== b) out[key] = { before: b, after: a }
  }
  return out
}

/**
 * Compare current sources against a snapshot.
 *
 * `ok` is false when a protected \\cite / \\label / \\ref / \\caption key was
 * lost or a previously-seen file disappeared. Numeric-token and table-row
 * drift never flips `ok`; it is surfaced in `drift` + `warnings`.
 * @param {object|null} snapshotRecord - result of {@link snapshot}.
 * @param {Array<{path: string, text: string}>|Record<string, string>} texSources - current sources.
 * @returns {{ok: boolean, unchanged: string[], changed: string[], added: string[], removed: string[], protected: object, protectedLost: string[], drift: object, warnings: string[]}}
 */
export function verifySnapshot(snapshotRecord, texSources) {
  const sources = normalizeSources(texSources)
  const current = extractProtected(sources)
  const base = snapshotRecord && snapshotRecord.protected ? snapshotRecord.protected : null
  const baseHashes = (snapshotRecord && snapshotRecord.hashes) || {}

  const nowHashes = {}
  for (const s of sources) nowHashes[s.path] = hashText(s.text)

  const unchanged = []
  const changed = []
  const added = []
  const removed = []
  for (const p of Object.keys(baseHashes)) {
    if (!(p in nowHashes)) removed.push(p)
    else if (nowHashes[p] === baseHashes[p]) unchanged.push(p)
    else changed.push(p)
  }
  for (const p of Object.keys(nowHashes)) if (!(p in baseHashes)) added.push(p)

  const protectedLost = []
  const drift = { cites: [], labels: [], refs: [], captions: [], numericTokens: {}, cells: [] }
  const warnings = []

  if (base) {
    const singles = [['cites', 'cite'], ['labels', 'label'], ['refs', 'ref'], ['captions', 'caption']]
    for (const [key, label] of singles) {
      const now = new Set(current[key] || [])
      const lost = (base[key] || []).filter((k) => !now.has(k))
      drift[key] = lost
      for (const k of lost) protectedLost.push(label + ':' + k)
    }
    drift.numericTokens = diffCounts(base.numericCounts, current.numericCounts)
    const nowCells = new Set(current.cells || [])
    drift.cells = (base.cells || []).filter((c) => !nowCells.has(c))
    if (drift.cells.length > 0) warnings.push('表格行内容缺失 ' + drift.cells.length + ' 行，请人工确认不是误删数据')
    if (Object.keys(drift.numericTokens).length > 0) {
      warnings.push('数字 token 发生变化（' + Object.keys(drift.numericTokens).length + ' 处），语义微调时须确认不是改了数据')
    }
  } else {
    warnings.push('NO_BASELINE：没有基线快照，仅能给出文件级差异')
  }

  return {
    ok: protectedLost.length === 0 && removed.length === 0,
    unchanged: unchanged.sort(),
    changed: changed.sort(),
    added: added.sort(),
    removed: removed.sort(),
    protected: current,
    protectedLost,
    drift,
    warnings,
  }
}
