/**
 * Round report writer.
 *
 * 0.2.1 REWRITE: the previous implementation rendered a vendored Markdown
 * template through a placeholder map. Two defects came out of that design and
 * both were reproducible: the ledger table was inserted inside a template table
 * that already had a header (so the header printed twice), and the progress table
 * was fed from model-supplied defectsBefore/defectsAfter arguments instead of the
 * ledger, so it was always all zeros unless the model retyped numbers it had
 * already recorded. This module generates the Markdown directly from the ledger
 * and the round record: no template, no placeholders, one source per number.
 *
 * Pure Node ESM — no DSH imports.
 * @module dsh-latex-studio/core/report
 */
import fs from 'node:fs'
import path from 'node:path'
import { workPaths, ensureDirs } from './state.js'

/** Defect categories in report order. */
export const CATEGORIES = Object.freeze(['A', 'B', 'C', 'D', 'E'])

/** Markdown table from headers and rows; an empty table renders as a note. */
function table(headers, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '_（无）_'
  const head = '| ' + headers.join(' | ') + ' |'
  const sep = '|' + headers.map(() => '---').join('|') + '|'
  const body = rows.map((row) => '| ' + row.map((cell) => String(cell ?? '—')).join(' | ') + ' |')
  return [head, sep, ...body].join('\n')
}

/** Markdown bullet list. */
function bullets(items, fallback) {
  const list = (Array.isArray(items) ? items : [])
    .filter((item) => item !== undefined && item !== null && String(item).trim() !== '')
    .map((item) => '- ' + String(item).trim())
  return list.length > 0 ? list.join('\n') : fallback
}

/** Normalize a count map / id list into a plain count map. */
function toCountMap(input) {
  const out = {}
  if (Array.isArray(input)) {
    for (const item of input) {
      if (!item) continue
      if (typeof item === 'string') out[item] = (out[item] || 0) + 1
      else if (item.id) out[String(item.id)] = Number(item.count ?? item.remaining ?? 1) || 0
    }
  } else if (input && typeof input === 'object') {
    for (const key of Object.keys(input)) out[String(key)] = Number(input[key]) || 0
  }
  return out
}

function progressFromCounts(before, after) {
  const rows = []
  let tInit = 0
  let tRem = 0
  for (const category of CATEGORIES) {
    let init = 0
    let rem = 0
    for (const id of Object.keys(before)) if (id.startsWith(category)) init += before[id]
    for (const id of Object.keys(after)) if (id.startsWith(category)) rem += after[id]
    tInit += init
    tRem += rem
    const pct = init > 0 ? Math.round(((init - rem) / init) * 100) + '%' : '—'
    rows.push([category, init, rem, pct])
  }
  const totalPct = tInit > 0 ? Math.round(((tInit - tRem) / tInit) * 100) + '%' : '—'
  rows.push(['**合计**', tInit, tRem, totalPct])
  return { rows, totals: { init: tInit, remaining: tRem } }
}

/**
 * Per-category progress from explicit counts (kept for callers that only have counts).
 * @param {object} data - {defectsBefore, defectsAfter}.
 * @returns {{rows: Array<Array<string|number>>, totals: {init: number, remaining: number}}}
 */
export function defectProgress(data = {}) {
  return progressFromCounts(toCountMap(data.defectsBefore), toCountMap(data.defectsAfter))
}

/**
 * Per-category progress computed from the defect ledger.
 *
 * 'initial' counts every entry recorded up to this round; 'remaining' counts the
 * entries still open. This is the only progress source the report uses, so the
 * numbers can no longer disagree with the table above them.
 * @param {Array<object>} ledger - ledger entries.
 * @param {number} round - current round.
 * @returns {{rows: Array<Array<string|number>>, totals: {init: number, remaining: number}}}
 */
export function ledgerProgress(ledger, round) {
  const entries = Array.isArray(ledger) ? ledger : []
  const before = {}
  const after = {}
  for (const entry of entries) {
    const id = String(entry.id ?? '')
    if (!id) continue
    const firstSeen = Number(entry.firstSeenRound ?? 0)
    if (!Number.isFinite(firstSeen) || firstSeen <= Number(round ?? Infinity)) {
      before[id] = (before[id] || 0) + 1
    }
    if (entry.status === 'open') after[id] = (after[id] || 0) + 1
  }
  return progressFromCounts(before, after)
}

/** Normalize the remaining-defect list into table rows. */
function remainingRows(data) {
  const source = data.remainingDefects ?? data.remaining ?? []
  if (!Array.isArray(source)) {
    const counts = toCountMap(source)
    return Object.keys(counts).map((id) => [id, '', '', String(counts[id])])
  }
  return source.map((item) => {
    if (typeof item === 'string') return [item, '', '', '']
    return [item.id ?? '', item.name ?? item.what ?? '', item.severity ?? '', item.note ?? item.detail ?? '']
  })
}

/** Quality-gate checklist as Markdown bullets. */
function gateLines(data) {
  const gate = data.gate ?? data.checks
  if (!gate || typeof gate !== 'object') return '_（未提供门禁检查项）_'
  const lines = []
  for (const key of Object.keys(gate)) {
    const value = gate[key]
    const status = value && typeof value === 'object' ? value.status : value
    const mark = status === 'pass' ? '✅' : status === 'fail' ? '⛔' : '➖'
    let detail = ''
    if (value && typeof value === 'object') {
      if (value.detail) detail = String(value.detail)
      else if (value.reason) detail = String(value.reason)
      else if (Array.isArray(value.blockingOpen) && value.blockingOpen.length > 0) detail = '阻断缺陷 ' + value.blockingOpen.join(',')
    }
    lines.push('- ' + mark + ' ' + key + (detail ? '：' + detail : ''))
  }
  return lines.length > 0 ? lines.join('\n') : '_（未提供门禁检查项）_'
}

/**
 * Render the report Markdown for one round.
 * @param {number} round - round number.
 * @param {object} data - round data (ledger, compile, integrity, gate, changes…).
 * @returns {{markdown: string, progress: object}}
 */
export function renderReportMarkdown(round, data = {}) {
  const compile = data.compile ?? {}
  const integrity = data.integrity ?? {}
  const ledger = Array.isArray(data.ledger) ? data.ledger : []
  const progress = ledgerProgress(ledger, round)
  const stamp = data.timestamp ?? new Date().toISOString()
  const conclusion = String(data.conclusion ?? data.verdict ?? 'INIT')
  const ledgerRows = ledger.map((entry) => [
    entry.id ?? '',
    entry.page ?? '—',
    entry.severity ?? '—',
    entry.gateBlocking === true ? '是' : '否',
    entry.status ?? 'open',
    String(entry.evidence ?? entry.reason ?? '—').slice(0, 80),
    entry.fixRound ?? '—',
  ])
  const hashStatus = integrity.hashStatus
    ?? (integrity.preHash && integrity.postHash ? (integrity.preHash === integrity.postHash ? '一致' : '不一致') : '未采集')

  const markdown = [
    '# LaTeX 排版诊断报告 — 第 ' + round + ' 轮',
    '',
    '**时间**：' + stamp,
    '**结论**：' + conclusion,
    '',
    '## 1. 编译',
    '',
    '- 状态：' + String(compile.status ?? '未记录（先跑 vto_verify）'),
    '- 引擎 / 驱动：' + String(compile.engine ?? '—') + ' / ' + String(compile.via ?? '—'),
    '- 日志错误：' + String(compile.errorCount ?? 0) + ' 条 / 警告：' + String(compile.warningCount ?? 0) + ' 条',
    '',
    '## 2. 缺陷台账',
    '',
    table(['缺陷', '页码', '严重度', '阻断门禁', '状态', '证据', '修复轮次'], ledgerRows),
    '',
    '> 台账按 ' + '`' + 'id+page' + '`' + ' 跨轮持久。' + '`' + 'status=fixed' + '`' + ' 的条目再次以 ' + '`' + 'open' + '`' + ' 出现时，' + '`' + 'vto_verify' + '`' + ' 会记一条 ' + '`' + 'ledgerRegression' + '`' + '。',
    '',
    '## 3. 消除进度（由台账计算，非人工填写）',
    '',
    table(['类别', '累计记录', '仍 open', '消除率'], progress.rows),
    '',
    '## 4. 本轮修改',
    '',
    bullets(data.changes, '_（本轮无修改记录）_'),
    '',
    '## 5. 剩余缺陷',
    '',
    table(['缺陷', '名称', '严重度', '说明'], remainingRows(data)),
    '',
    '## 6. 内容完整性',
    '',
    '- 受保护内容哈希：' + '`' + String(integrity.preHash ?? '—') + '`' + ' → ' + '`' + String(integrity.postHash ?? '—') + '`' + '（' + hashStatus + '）',
    '',
    '## 7. 门禁判定依据',
    '',
    gateLines(data),
    '',
    '**结论**：' + conclusion,
    '',
  ].join('\n')

  return { markdown, progress }
}

/**
 * Write reports/round-<n>.json + reports/round-<n>.md.
 * @param {string} workDir - work dir.
 * @param {number} round - round number.
 * @param {object} data - round data.
 * @returns {{jsonPath: string, mdPath: string}}
 */
export function writeRoundReport(workDir, round, data = {}) {
  const paths = workPaths(ensureDirs(workDir))
  const jsonPath = path.join(paths.reports, 'round-' + round + '.json')
  const mdPath = path.join(paths.reports, 'round-' + round + '.md')
  const rendered = renderReportMarkdown(round, data)
  fs.writeFileSync(jsonPath, JSON.stringify({ round, generatedAt: new Date().toISOString(), data }, null, 2) + '\n', 'utf8')
  fs.writeFileSync(mdPath, rendered.markdown, 'utf8')
  return { jsonPath, mdPath }
}