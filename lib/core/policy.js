/**
 * Forbidden-practice policy for the VTO repair loop (INTERFACES.md §7).
 *
 * Rationale: the four low-effort "fixes" below are what makes an automated
 * typesetting pass untrustworthy — they hide a layout problem instead of
 * solving it, and they destroy cross-template portability.
 *
 * `checkPolicy(beforeText, afterText)` reports only occurrences that are NEW
 * in `afterText`: policy is a *diff* gate, not a lint of the whole document,
 * so a paper that already contains a legacy `\\vspace` is not re-flagged every
 * round. Matching is line-signature based (trimmed + whitespace-collapsed), so
 * reindenting a line does not count as an added offence.
 *
 * The rule table itself lives in `lib/core/rules.js` (single source, shared with
 * `lint.js`); this module keeps the diff-gate semantics and re-exports it.
 *
 * Pure Node ESM — no DSH imports.
 * @module dsh-latex-studio/core/policy
 */
import { FORBIDDEN } from './rules.js'

export { FORBIDDEN }

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
