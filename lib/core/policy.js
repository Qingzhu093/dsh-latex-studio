/**
 * Forbidden-practice policy for the VTO repair loop (INTERFACES.md §7).
 *
 * Rationale: the four low-effort "fixes" below are what makes an automated
 * typesetting pass untrustworthy — they hide a layout problem instead of
 * solving it, and they destroy cross-template portability.
 *
 * `checkPolicy(beforeText, afterText)` reports only occurrences that are NEW
 * in `afterText`: policy is a *diff* gate, not a lint of the whole document,
 * so a paper that already contains a legacy `\vspace` is not re-flagged every
 * round. Matching is line-signature based (trimmed + whitespace-collapsed), so
 * reindenting a line does not count as an added offence.
 *
 * Pure Node ESM — no DSH imports.
 * @module dsh-latex-studio/core/policy
 */

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

/** Fresh global RegExp per call: shared literals would carry `lastIndex` state. */
function freshRe(re) {
  return new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
}

/** 1-based line number of one offset. */
function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

/** The full source line containing `index` (used as the diff signature). */
function lineTextOf(text, index) {
  const start = text.lastIndexOf('\n', index - 1) + 1
  let end = text.indexOf('\n', index)
  if (end < 0) end = text.length
  return text.slice(start, end)
}

/**
 * All matches of one rule inside a text.
 * @param {object} rule - a FORBIDDEN entry.
 * @param {string} text - source text.
 * @returns {Array<{index: number, line: number, lineText: string, matched: string}>}
 */
export function matchRule(rule, text) {
  const source = typeof text === 'string' ? text : ''
  const re = freshRe(rule.pattern)
  const out = []
  let m
  while ((m = re.exec(source)) !== null) {
    out.push({
      index: m.index,
      line: lineOf(source, m.index),
      lineText: lineTextOf(source, m.index),
      matched: m[0],
    })
    if (m[0].length === 0) re.lastIndex++
  }
  return out
}

/** Normalize a source line into a comparison signature. */
function signature(lineText) {
  return String(lineText).trim().replace(/\s+/g, ' ')
}

/**
 * Occurrences of `rule` present in `afterText` but not accounted for by
 * `beforeText` (line-signature multiset subtraction).
 * @param {object} rule - a FORBIDDEN entry.
 * @param {string} beforeText - pre-fix text.
 * @param {string} afterText - post-fix text.
 * @returns {Array<object>} newly added matches.
 */
export function diffRule(rule, beforeText, afterText) {
  const pool = new Map()
  for (const m of matchRule(rule, beforeText)) {
    const key = signature(m.lineText)
    pool.set(key, (pool.get(key) || 0) + 1)
  }
  const added = []
  for (const m of matchRule(rule, afterText)) {
    const key = signature(m.lineText)
    const left = pool.get(key) || 0
    if (left > 0) {
      pool.set(key, left - 1)
      continue
    }
    added.push(m)
  }
  return added
}

/**
 * Policy gate: which forbidden practices does `afterText` newly introduce?
 * @param {string} beforeText - text before the change (empty for a fresh check).
 * @param {string} afterText - text after the change.
 * @param {{skip?: string[]}} [options] - `skip` lists rule ids to ignore.
 * @returns {{violations: Array<{id: string, line: number, message: string, hint: string, name: string, severity: string, matched: string}>, counts: Record<string, {before: number, after: number, added: number}>, ok: boolean}}
 */
export function checkPolicy(beforeText, afterText, options = {}) {
  const before = typeof beforeText === 'string' ? beforeText : ''
  const after = typeof afterText === 'string' ? afterText : ''
  const skip = new Set(Array.isArray(options.skip) ? options.skip : [])
  const violations = []
  const counts = {}

  for (const rule of FORBIDDEN) {
    if (skip.has(rule.id)) continue
    const added = diffRule(rule, before, after)
    counts[rule.id] = {
      before: matchRule(rule, before).length,
      after: matchRule(rule, after).length,
      added: added.length,
    }
    const extra = added.length - (Number(rule.newAllowed) || 0)
    if (extra <= 0) continue
    for (const m of added) {
      violations.push({
        id: rule.id,
        name: rule.name,
        severity: rule.severity,
        line: m.line,
        matched: m.matched,
        message: rule.message,
        hint: rule.hint,
      })
    }
  }

  return { violations, counts, ok: violations.length === 0 }
}

/**
 * Count every forbidden practice in one text (no diff baseline).
 * @param {string} text - source text.
 * @returns {Record<string, number>} rule id -> occurrence count.
 */
export function scanForbidden(text) {
  const out = {}
  for (const rule of FORBIDDEN) out[rule.id] = matchRule(rule, text).length
  return out
}

/**
 * Human-readable one-liner per violation, for tool output.
 * @param {Array<object>} violations - checkPolicy violations.
 * @returns {string[]} lines.
 */
export function describeViolations(violations) {
  if (!Array.isArray(violations) || violations.length === 0) return []
  return violations.map((v) => '第 ' + v.line + ' 行 [' + v.id + '] ' + v.message + ' → ' + v.hint)
}
