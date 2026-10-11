/**
 * Round report writer for the VTO loop (INTERFACES.md \10).
 *
 * The Markdown body comes from `lib/data/diagnostic_report.template.md`
 * (vendored from PaperFit, MIT); every `{{PLACEHOLDER}}` is filled from a
 * normalized data map, and any placeholder the caller did not supply renders as
 * `—` instead of being left in the document. A JSON sidecar carries the same
 * data for machine consumption.
 *
 * Pure Node ESM — no DSH imports.
 * @module dsh-latex-studio/core/report
 */
import fs from 'node:fs'
import path from 'node:path'
import { workPaths, ensureDirs } from './state.js'

/** Template location, resolved relative to this module (works with spaces/中文). */
export const TEMPLATE_URL = new URL('../data/diagnostic_report.template.md', import.meta.url)

/** Defect categories in report order. */
export const CATEGORIES = Object.freeze(['A', 'B', 'C', 'D', 'E'])

/** Last-resort template used when the vendored file is missing. */
export const FALLBACK_TEMPLATE = [
  '# LaTeX 排版诊断报告 — 第 {{ROUND}} 轮',
  '',
  '**时间**：{{TIMESTAMP}}',
  '**状态**：{{STATUS_LINE}}',
  '',
  '## 编译摘要',
  '- 编译状态：{{COMPILE_STATUS}}',
  '- 日志错误数：{{LOG_ERROR_COUNT}}',
  '- 日志警告数：{{LOG_WARN_COUNT}}',
  '',
  '## 缺陷消除进度',
  '{{DEFECT_PROGRESS_TABLE}}',
  '',
  '## 本轮修改摘要',
  '{{CHANGES_SUMMARY}}',
  '',
  '## 剩余缺陷',
  '{{REMAINING_DEFECTS_TABLE}}',
  '',
  '## 内容完整性验证',
  '{{CONTENT_INTEGRITY_BLOCK}}',
  '',
  '## 质量门禁判定依据',
  '{{GATE_CHECKLIST}}',
  '',
  '**结论**：{{CONCLUSION_LINE}}',
  '',
].join('\n')

/**
 * Read the vendored template.
 * @returns {{template: string, source: 'file'|'fallback', path: string|null, error: string|null}}
 */
export function loadTemplate() {
  try {
    const file = TEMPLATE_URL
    const template = fs.readFileSync(file, 'utf8')
    return { template, source: 'file', path: String(file), error: null }
  } catch (error) {
    return { template: FALLBACK_TEMPLATE, source: 'fallback', path: null, error: String((error && error.message) || error) }
  }
}

/**
 * Substitute `{{PLACEHOLDER}}` tokens.
 * @param {string} template - markdown template.
 * @param {Record<string, unknown>} values - replacement map.
 * @param {string} [fallback='—'] - value for unknown placeholders.
 * @returns {string} filled markdown.
 */
export function fillTemplate(template, values, fallback = '—') {
  const map = values && typeof values === 'object' ? values : {}
  return String(template).replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    const value = map[key]
    if (value === undefined || value === null || value === '') return fallback
    return String(value)
  })
}

/** List the placeholders a template references, in order of appearance. */
export function templatePlaceholders(template) {
  const out = []
  const re = /\{\{([A-Z0-9_]+)\}\}/g
  let m
  while ((m = re.exec(String(template))) !== null) if (!out.includes(m[1])) out.push(m[1])
  return out
}

/** Markdown bullet list, or a single fallback line. */
function bulletList(items, fallback) {
  if (Array.isArray(items)) {
    const lines = items.filter((x) => x !== undefined && x !== null && String(x).trim() !== '').map((x) => '- ' + String(x).trim())
    if (lines.length > 0) return lines.join('\n')
  }
  return fallback
}

/** Markdown table from a header + rows; empty rows render as a fallback line. */
function table(headers, rows, fallback) {
  if (!Array.isArray(rows) || rows.length === 0) return fallback
  const head = '| ' + headers.join(' | ') + ' |'
  const sep = '|' + headers.map(() => '---').join('|') + '|'
  const body = rows.map((r) => '| ' + r.map((c) => String(c)).join(' | ') + ' |')
  return [head, sep, ...body].join('\n')
}

/** Normalize a count map / id list into `Record<defectId, number>`. */
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

/**
 * Compute the per-category defect progress table (A–E + total).
 * @param {object} data - round data; `defects`, `defectsBefore`, `defectsAfter` accepted.
 * @returns {{rows: Array<Array<string|number>>, html: string, totals: object}}
 */
export function defectProgress(data = {}) {
  const before = toCountMap(data.defectsBefore ?? data.baselineDefects ?? data.defects?.before)
  const after = toCountMap(data.defectsAfter ?? data.defects?.after)
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

  return {
    rows,
    html: table(['缺陷类别', '初始数量', '剩余数量', '消除率'], rows, '（无缺陷统计）'),
    totals: { init: tInit, remaining: tRem },
  }
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

/** Normalize the quality-gate checklist into markdown bullets. */
function gateLines(data) {
  const gate = data.gate ?? data.checks
  if (Array.isArray(gate)) {
    return gate.map((item) => {
      if (typeof item === 'string') return item
      const mark = item.ok === true || item.status === 'pass' ? '✅' : item.ok === false || item.status === 'fail' ? '⛔' : '➖'
      const name = item.name ?? item.id ?? item.check ?? '检查项'
      const detail = item.detail ?? item.message ?? item.status ?? ''
      return mark + ' ' + name + (detail ? '：' + detail : '')
    })
  }
  if (gate && typeof gate === 'object') {
    return Object.keys(gate).map((key) => {
      const value = gate[key]
      const ok = value && typeof value === 'object' ? value.ok ?? value.status : value
      const mark = ok === true || ok === 'pass' || ok === 'ok' ? '✅' : ok === false || ok === 'fail' ? '⛔' : '➖'
      const detail = value && typeof value === 'object' ? value.detail ?? value.reason ?? value.status ?? '' : String(value)
      return mark + ' ' + key + (detail ? '：' + detail : '')
    })
  }
  return []
}

/**
 * Build the full placeholder value map for one round.
 * @param {number} round - round number.
 * @param {object} data - round data.
 * @returns {Record<string, string>} placeholder values.
 */
export function buildReportValues(round, data = {}) {
  const compile = data.compile ?? {}
  const errors = Array.isArray(compile.errors) ? compile.errors : []
  const warnings = Array.isArray(compile.warnings) ? compile.warnings : []
  const progress = defectProgress(data)
  const cv = data.columnVoid ?? {}
  const integrity = data.integrity ?? {}
  const stamp = data.timestamp ?? new Date().toISOString()

  const cvByPage = cv.byPage
  const cvMarkdown =
    cvByPage && typeof cvByPage === 'object' && Object.keys(cvByPage).length > 0
      ? table(
          ['页码', 'A5 候选', '备注'],
          Object.keys(cvByPage).map((page) => [page, String(cvByPage[page]?.count ?? cvByPage[page] ?? ''), String(cvByPage[page]?.note ?? '')]),
          cvMarkdownFallback(cv)
        )
      : cvMarkdownFallback(cv)

  const wordBefore = integrity.wordCountBefore ?? data.wordCountBefore
  const wordAfter = integrity.wordCountAfter ?? data.wordCountAfter
  let wordChange = integrity.wordCountChange
  if (wordChange === undefined && Number.isFinite(Number(wordBefore)) && Number(wordBefore) > 0 && Number.isFinite(Number(wordAfter))) {
    wordChange = (((Number(wordAfter) - Number(wordBefore)) / Number(wordBefore)) * 100).toFixed(2) + '%'
  }

  return {
    ROUND: String(round),
    TIMESTAMP: String(stamp),
    STATUS_LINE: String(data.statusLine ?? data.verdict ?? 'INIT'),
    COMPILE_STATUS: compile.compileSuccess === true ? 'passed' : compile.status ?? (compile.compileSuccess === false ? 'failed' : '未编译'),
    LOG_ERROR_COUNT: String(Number.isFinite(Number(compile.errorCount)) ? Number(compile.errorCount) : errors.length),
    LOG_WARN_COUNT: String(Number.isFinite(Number(compile.warningCount)) ? Number(compile.warningCount) : warnings.length),
    COLUMN_VOID_REPORT: String(cv.reportPath ?? '本栏不适用（单栏任务或未运行机检）'),
    CV_A5_COUNT: String(cv.a5Count ?? (Array.isArray(cv.a5Pages) ? cv.a5Pages.length : 0)),
    CV_A5_PAGES: Array.isArray(cv.a5Pages) && cv.a5Pages.length > 0 ? cv.a5Pages.join(', ') : '—',
    CV_BY_PAGE_MARKDOWN: cvMarkdown,
    A_INIT: String(progress.rows[0][1]),
    A_REM: String(progress.rows[0][2]),
    A_PCT: String(progress.rows[0][3]),
    B_INIT: String(progress.rows[1][1]),
    B_REM: String(progress.rows[1][2]),
    B_PCT: String(progress.rows[1][3]),
    C_INIT: String(progress.rows[2][1]),
    C_REM: String(progress.rows[2][2]),
    C_PCT: String(progress.rows[2][3]),
    D_INIT: String(progress.rows[3][1]),
    D_REM: String(progress.rows[3][2]),
    D_PCT: String(progress.rows[3][3]),
    E_INIT: String(progress.rows[4][1]),
    E_REM: String(progress.rows[4][2]),
    E_PCT: String(progress.rows[4][3]),
    T_INIT: String(progress.totals.init),
    T_REM: String(progress.totals.remaining),
    T_PCT: String(progress.rows[5][3]),
    CHANGES_SUMMARY: bulletList(data.changes ?? data.changesSummary, '本轮无修改（或未提供修改摘要）。'),
    LEDGER_TABLE: table(
      ['缺陷', '页码', '严重度', '阻断', '状态', '证据', '修复轮次'],
      (Array.isArray(data.ledger) ? data.ledger : []).map((entry) => [
        String(entry.id ?? ''),
        entry.page === null || entry.page === undefined ? '—' : String(entry.page),
        String(entry.severity ?? '—'),
        entry.gateBlocking === true ? '是' : '否',
        String(entry.status ?? 'open'),
        String(entry.evidence ?? entry.reason ?? '—').slice(0, 80),
        entry.fixRound === null || entry.fixRound === undefined ? '—' : String(entry.fixRound),
      ]),
      '（台账为空：本轮未记录缺陷）'
    ),
    REMAINING_DEFECTS_TABLE: table(
      ['缺陷', '名称', '严重度', '说明'],
      remainingRows(data),
      '无剩余缺陷。'
    ),
    PRE_HASH: String(integrity.preHash ?? '—'),
    POST_HASH: String(integrity.postHash ?? '—'),
    HASH_STATUS: String(integrity.hashStatus ?? (integrity.preHash && integrity.postHash ? (integrity.preHash === integrity.postHash ? '一致' : '不一致') : '未验证')),
    WORD_COUNT_BEFORE: wordBefore === undefined ? '—' : String(wordBefore),
    WORD_COUNT_AFTER: wordAfter === undefined ? '—' : String(wordAfter),
    WORD_COUNT_CHANGE: wordChange === undefined ? '—' : String(wordChange),
    ABSTRACT_STATUS: String(integrity.abstractStatus ?? '未检查'),
    CONCLUSIONS_STATUS: String(integrity.conclusionsStatus ?? '未检查'),
    CONTENT_CHANGE_DETAILS: bulletList(integrity.details ?? data.contentChangeDetails, '无内容变更。'),
    CONTENT_INTEGRITY_ALERT:
      integrity.alert === undefined || integrity.alert === null || integrity.alert === ''
        ? ''
        : '> ⚠️ **内容完整性告警**：' + String(integrity.alert),
    GATE_CHECKLIST: bulletList(gateLines(data), '未提供门禁检查项。'),
    CONCLUSION_LINE: String(data.conclusion ?? data.verdict ?? 'INIT'),
  }
}

/** Fallback text for the OpenCV column-void section. */
function cvMarkdownFallback(cv) {
  if (cv && cv.applicable === false) return '本栏不适用'
  return '未运行机检（或未提供按页摘要）。'
}

/**
 * Render the report markdown for one round.
 * @param {number} round - round number.
 * @param {object} data - round data.
 * @param {string} [template] - override template.
 * @returns {{markdown: string, template: {source: string, path: string|null, error: string|null}, values: Record<string, string>}}
 */
export function renderReportMarkdown(round, data = {}, template) {
  const loaded = template !== undefined && template !== null
    ? { template: String(template), source: 'override', path: null, error: null }
    : loadTemplate()
  const values = buildReportValues(round, data)
  return { markdown: fillTemplate(loaded.template, values), template: { source: loaded.source, path: loaded.path, error: loaded.error }, values }
}

/**
 * Write `reports/round-<n>.json` + `reports/round-<n>.md`.
 * @param {string} workDir - work dir.
 * @param {number} round - round number.
 * @param {object} data - round data.
 * @returns {{jsonPath: string, mdPath: string, template: object}}
 */
export function writeRoundReport(workDir, round, data = {}) {
  const paths = workPaths(ensureDirs(workDir))
  const jsonPath = path.join(paths.reports, 'round-' + round + '.json')
  const mdPath = path.join(paths.reports, 'round-' + round + '.md')
  const rendered = renderReportMarkdown(round, data)

  // Content-integrity guard: report placeholders must never leak to the reader.
  const unresolved = templatePlaceholders(rendered.markdown)
  const payload = {
    round,
    generatedAt: new Date().toISOString(),
    template: rendered.template,
    unresolvedPlaceholders: unresolved,
    data,
  }

  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  fs.writeFileSync(mdPath, rendered.markdown.endsWith('\n') ? rendered.markdown : rendered.markdown + '\n', 'utf8')
  return { jsonPath, mdPath, template: rendered.template }
}
