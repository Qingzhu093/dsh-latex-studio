/**
 * Content-integrity guard for the VTO repair loop (INTERFACES.md §6).
 *
 * A repair pass may only change *layout*. This module freezes the academic
 * content that must survive a rewrite — citation/label/ref keys, captions,
 * numeric tokens and table rows — and then reports exactly what changed.
 *
 * Blocking vs advisory:
 *  - lost \\cite / \\label / \\ref / \\caption keys block the fix (ok=false);
 *  - numeric-token and table-row drift is reported as a warning, because a
 *    legitimate 3–8 word semantic micro-tuning (taxonomy A1/A2) may move a
 *    number into different prose without changing the data.
 *
 * `extractProtected`/`normalizeSources`/`hashText` live in `lib/core/rules.js`
 * (single source, shared with `lint.js`) and are re-exported here so every
 * existing import site keeps working.
 *
 * Pure Node ESM — no DSH imports.
 * @module dsh-latex-studio/core/guard
 */
export { hashText, normalizeSources, extractProtected } from './rules.js'
import { extractProtected, hashText, normalizeSources } from './rules.js'

/** 1-based line number of one offset. */
function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++
  return line
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

// --- secret scanning --------------------------------------------------------

/** Secret-shaped patterns worth stopping a commit for. */
export const SECRET_PATTERNS = Object.freeze([
  { name: 'openai-key', pattern: /sk-[A-Za-z0-9_-]{16,}/g },
  { name: 'github-pat', pattern: /ghp_[A-Za-z0-9]{20,}/g },
  { name: 'github-fine-grained-pat', pattern: /github_pat_[A-Za-z0-9_]{20,}/g },
  { name: 'aws-access-key-id', pattern: /AKIA[0-9A-Z]{16}/g },
  { name: 'slack-token', pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'private-key-block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g },
  {
    name: 'generic-assignment',
    pattern: /(?:api[_-]?key|apikey|secret|token|passwd|password)\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/gi,
  },
])

/** Mask a secret so the report never re-leaks it. */
function maskSecret(matched) {
  const head = matched.slice(0, 4)
  const tail = matched.length > 8 ? matched.slice(-2) : ''
  return head + '***' + tail
}

/**
 * Scan text for secret-shaped tokens.
 * @param {string} text - source text.
 * @returns {Array<{pattern: string, line: number, excerpt: string}>} findings (secrets masked).
 */
export function scanSecrets(text) {
  const source = typeof text === 'string' ? text : ''
  const findings = []
  for (const { name, pattern } of SECRET_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
    let m
    while ((m = re.exec(source)) !== null) {
      const before = source.lastIndexOf('\n', m.index) + 1
      let after = source.indexOf('\n', m.index)
      if (after < 0) after = source.length
      const line = source.slice(before, after).trim()
      const excerpt = line.replace(m[0], maskSecret(m[0])).slice(0, 200)
      findings.push({ pattern: name, line: lineOf(source, m.index), excerpt })
      if (m[0].length === 0) re.lastIndex++
    }
  }
  return findings.sort((a, b) => a.line - b.line)
}