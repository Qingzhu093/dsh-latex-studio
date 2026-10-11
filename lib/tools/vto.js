/**
 * VTO (Visual Typesetting Optimization) tool surface — INTERFACES.md 11.
 *
 * Registered tools: `vto_start`, `vto_inspect`, `vto_fix`, `vto_verify`,
 * `vto_report`.
 *
 * Layering rules honoured here:
 *  - every `lib/core/*` module stays DSH-free; this file is the only place that
 *    bridges to the harness (`@deepseek-ai/dsh-tools`, `ctx.tools`,
 *    `ctx.attachments`, the injected `callReadPdf` bridge);
 *  - all path parameters are WORKSPACE-RELATIVE — absolute paths and `..` are
 *    rejected before touching the filesystem;
 *  - a missing external piece degrades to `skipped` + advice, never a throw.
 * @module dsh-latex-studio/tools/vto
 */
import fs from 'node:fs'
import path from 'node:path'
import { normalizeConfig } from '../config.js'
import {
  PathError,
  resolveInside,
  resolveWorkspacePath as coreResolveWorkspacePath,
} from '../core/paths.js'
import {
  newState,
  loadStateSafe,
  saveState,
  backupFiles,
  rollback,
  recordRound,
  latestRoundRecord,
  resolveWorkDir,
  workPaths,
  DEFAULT_MAX_ROUNDS,
} from '../core/state.js'
import { snapshot, verifySnapshot, scanSecrets } from '../core/guard.js'
import { checkPolicy, describeViolations, FORBIDDEN } from '../core/policy.js'
import { renderPages, countPdfPages } from '../core/render.js'
import { analyzePageImage } from '../core/voidetect.js'
import { writeRoundReport } from '../core/report.js'
import { checkPdfRead, describeGate } from '../core/pdfread.js'

/** Path separator regex used to normalize project-relative keys. */
const BS_RE = /[\\/]/

/**
 * `defineTool` is the only DSH import in the plugin's B line. It is loaded
 * dynamically so the core stays testable and a partial install degrades to
 * "vto subsystem not registered" instead of a hard module error.
 */
let defineTool = null
let defineToolError = null
try {
  const mod = await import('@deepseek-ai/dsh-tools')
  defineTool = mod.defineTool
} catch (error) {
  defineToolError = String((error && error.message) || error)
}

/** Taxonomy location (vendored from PaperFit, MIT). */
export const TAXONOMY_URL = new URL('../data/vto_taxonomy.json', import.meta.url)

/** Directories never scanned for tex sources. */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', 'aux', 'pages', 'reports', 'backups'])

const FENCE = String.fromCharCode(96).repeat(3)

// ---------------------------------------------------------------------------
// path safety — single implementation lives in lib/core/paths.js
// ---------------------------------------------------------------------------

// Re-exported so the tool layer keeps one import site for path concerns and the
// existing tests/consumers keep working. These are NOT second implementations.
export { PathError, resolveInside }

/**
 * Validate a workspace-relative path: no absolute path, no drive letter, no `..`.
 *
 * Thin adapter over {@link coreResolveWorkspacePath} kept as an exported name
 * because the tool layer and its tests refer to it. There is exactly ONE path
 * guard implementation in this plugin (lib/core/paths.js); a second copy is how
 * the E4 forward-slash-root regression happened in the first place.
 * @param {unknown} input - raw parameter.
 * @param {string} label - parameter name used in the error message.
 * @param {string} [root] - the tree the path must stay inside. Callers MUST pass
 *   the project/session root they are about to join the result onto; leaving it
 *   at the default silently checks containment against `process.cwd()`, which is
 *   the plugin's own directory rather than the user's workspace.
 * @returns {string} the normalized relative path.
 * @throws {PathError} when the path is absolute, UNC, empty or escapes the workspace.
 */
export function safeRel(input, label = 'path', root = process.cwd()) {
  const result = coreResolveWorkspacePath(input, root, label)
  if (!result.ok) throw new PathError(result.message, result.code)
  return path.normalize(result.rel)
}


/** Session workspace root: session header cwd, else process cwd. */
export function sessionCwd(ctx, exec) {
  const header = exec && exec.agent && exec.agent.session ? exec.agent.session.header : undefined
  if (header && typeof header.cwd === 'string' && header.cwd !== '') return header.cwd
  try {
    const fsService = ctx && typeof ctx.get === 'function' ? ctx.get('fs') : undefined
    if (fsService && typeof fsService.cwd === 'string' && fsService.cwd !== '') return fsService.cwd
  } catch {
    /* optional service */
  }
  return process.cwd()
}

/** Resolve an optional workspace-relative directory to an absolute project dir. */
export function resolveProjectDir(ctx, exec, config, dirInput) {
  const cwd = sessionCwd(ctx, exec)
  if (dirInput === undefined || dirInput === null || dirInput === '') return path.resolve(cwd)
  return path.resolve(cwd, safeRel(dirInput, 'dir'))
}

// ---------------------------------------------------------------------------
// tex sources, pdf discovery
// ---------------------------------------------------------------------------

/**
 * Read every `.tex` file under a project (bounded walk).
 * @param {string} projectDir - absolute project dir.
 * @param {{maxFiles?: number, maxBytes?: number}} [options] - bounds.
 * @returns {Array<{path: string, text: string}>} sources with project-relative paths.
 */
export function collectTexSources(projectDir, options = {}) {
  const maxFiles = Number(options.maxFiles) || 400
  const maxBytes = Number(options.maxBytes) || 2 * 1024 * 1024
  const out = []
  const walk = (dir, depth) => {
    if (out.length >= maxFiles || depth > 8) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        walk(full, depth + 1)
        continue
      }
      if (!entry.isFile() || !/\.tex$/i.test(entry.name)) continue
      try {
        const stat = fs.statSync(full)
        if (stat.size > maxBytes) continue
        out.push({ path: path.relative(projectDir, full), text: fs.readFileSync(full, 'utf8') })
      } catch {
        /* unreadable file: skip */
      }
    }
  }
  walk(projectDir, 0)
  return out
}

/** Guess the entry tex file. */
export function detectEntry(projectDir) {
  const preferred = ['main.tex', 'paper.tex', 'manuscript.tex', 'article.tex', 'thesis.tex']
  for (const name of preferred) {
    try {
      if (fs.statSync(path.join(projectDir, name)).isFile()) return name
    } catch {
      /* keep looking */
    }
  }
  const found = collectTexSources(projectDir, { maxFiles: 50 })
  return found.length > 0 ? found[0].path : null
}

/** Infer single/double column layout from the sources. */
export function inferColumnType(texSources) {
  const text = (texSources || []).map((s) => s.text).join('\n')
  if (/twocolumn/i.test(text)) return 'double'
  if (/\\documentclass\s*(?:\[[^\]]*\])?\s*{\s*(?:IEEEtran|llncs)/i.test(text)) return 'single'
  if (/\\usepackage(?:\[[^\]]*\])?\s*{\s*multicol/i.test(text)) return 'double'
  return 'single'
}

/** Locate the compiled PDF for a project. */
export function findPdf(projectDir, workDir, entry) {
  const candidates = []
  if (entry) {
    const base = path.basename(String(entry), path.extname(String(entry)))
    candidates.push(path.join(projectDir, path.dirname(String(entry)), base + '.pdf'))
    candidates.push(path.join(workDir, 'build', base + '.pdf'))
  }
  candidates.push(path.join(projectDir, 'main.pdf'))
  candidates.push(path.join(workDir, 'build', 'main.pdf'))
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      /* next */
    }
  }
  for (const dir of [projectDir, path.join(workDir, 'build')]) {
    try {
      const found = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort()
      if (found.length > 0) return path.join(dir, found[0])
    } catch {
      /* next */
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// checklist (from the vendored taxonomy)
// ---------------------------------------------------------------------------

let taxonomyCache = null

/** Load the defect taxonomy; returns an empty skeleton when unreadable. */
export function loadTaxonomy() {
  if (taxonomyCache) return taxonomyCache
  try {
    taxonomyCache = JSON.parse(fs.readFileSync(TAXONOMY_URL, 'utf8'))
  } catch {
    taxonomyCache = { version: null, categories: [], defects: [] }
  }
  return taxonomyCache
}

/**
 * Thresholds that live in `lib/data/layout_rules.json` rather than inside the
 * taxonomy entry, keyed by defect id. PaperFit keeps these in
 * `config/layout_rules.yaml` and the detective agent reads them from there; the
 * DSH port vendors the same file, so bind them here instead of copying numbers
 * into each taxonomy entry (one source of truth, and `test/docs.test.mjs`-style
 * drift is impossible).
 */
const LAYOUT_RULE_BY_DEFECT = Object.freeze({
  A1: ['paragraph.short_last_line_max_ratio'],
  A2: ['whitespace.trailing_whitespace_max_ratio'],
  A4: ['whitespace.column_balance_max_diff_lines'],
  A5: ['intra_column_void.min_void_ratio_of_column', 'intra_column_void.min_void_height_lines'],
  B1: ['float.max_reference_distance_pages'],
  B2: ['table.min_width_utilization', 'table.max_width_utilization'],
  B3: ['float.max_consecutive_floats', 'float.min_text_between_floats_lines'],
  D1: ['equation.overflow_severity_threshold_pt'],
  D2: ['equation.max_width_ratio'],
})

let layoutRulesCache = null

/** Load the vendored layout thresholds; empty object when unreadable. */
export function loadLayoutRules() {
  if (layoutRulesCache) return layoutRulesCache
  try {
    layoutRulesCache = JSON.parse(fs.readFileSync(new URL('../data/layout_rules.json', import.meta.url), 'utf8'))
  } catch {
    layoutRulesCache = {}
  }
  return layoutRulesCache
}

/** Resolve a dotted path ("float.max_reference_distance_pages") against the rules. */
function readDotted(object, dotted) {
  let node = object
  for (const key of String(dotted).split('.')) {
    if (node === null || typeof node !== 'object' || !(key in node)) return undefined
    node = node[key]
  }
  return node
}

/**
 * Build the visual checklist for the 18 taxonomy defects.
 * @param {{columnType?: 'single'|'double', focus?: string|null, ids?: string|null}} [options] - filters.
 * @returns {Array<object>} checklist items `{id, what, thresholds, layoutRules, ...}`.
 */
export function buildChecklist(options = {}) {
  const taxonomy = loadTaxonomy()
  const rules = loadLayoutRules()
  const columnType = options.columnType === 'double' ? 'double' : 'single'
  const ids = options.ids ? new Set(String(options.ids).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)) : null
  const focus = options.focus ? new Set(String(options.focus).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)) : null
  const forbiddenIds = FORBIDDEN.map((rule) => rule.id)
  const items = []

  for (const defect of taxonomy.defects || []) {
    if (ids && !ids.has(defect.id)) continue
    if (focus && !focus.has(defect.id) && !focus.has(String(defect.category || '').toUpperCase())) continue
    if (columnType !== 'double' && (defect.id === 'A4' || defect.id === 'A5')) continue
    // Numeric thresholds: the taxonomy carries some inline, the rest live in
    // layout_rules.json. Both are exposed so the model never has to guess a bar.
    const layoutRules = {}
    for (const dotted of LAYOUT_RULE_BY_DEFECT[defect.id] || []) {
      const value = readDotted(rules, dotted)
      if (value !== undefined) layoutRules[dotted] = value
    }
    items.push({
      id: defect.id,
      what: defect.name + ' — ' + String(defect.description || '').replace(/\s+/g, ' ').slice(0, 180),
      thresholds: defect.detection && defect.detection.threshold ? defect.detection.threshold : null,
      layoutRules,
      severity: defect.severity,
      category: defect.category,
      page_image_required: Boolean(defect.detection && defect.detection.page_image_required),
      metric: defect.evaluation_metric || null,
      allowed: (defect.fix_strategy && defect.fix_strategy.approaches) || [],
      semantic_allowed: Boolean(defect.fix_strategy && defect.fix_strategy.semantic_allowed),
      forbidden: forbiddenIds,
    })
  }
  return items
}

// ---------------------------------------------------------------------------
// edit application + diff
// ---------------------------------------------------------------------------

/**
 * Apply a list of literal find/replace edits.
 *
 * The replacement is inserted LITERALLY. `String.prototype.replace` treats `$&`,
 * `` $` ``, `$'`, `$1`..`$9` and `$$` in the replacement string as capture-group
 * patterns, which silently corrupts LaTeX: `$` is math-mode delimiters, so a
 * replacement such as `$O(n^2)$` or even a bare `$$` would be rewritten. The
 * callback form disables that expansion.
 *
 * @param {string} text - current file text.
 * @param {Array<{find: string, replace?: string, replaceAll?: boolean}>} edits - edits.
 * @returns {{ok: boolean, text?: string, applied?: Array<object>, code?: string, message?: string, matches?: number}}
 */
export function applyEdits(text, edits) {
  let out = String(text ?? '')
  const applied = []
  for (const edit of Array.isArray(edits) ? edits : []) {
    const find = typeof edit.find === 'string' ? edit.find : ''
    if (find === '') return { ok: false, code: 'EMPTY_FIND', message: 'find 不能为空' }
    const count = out.split(find).length - 1
    if (count === 0) return { ok: false, code: 'EDIT_NOT_FOUND', message: '未找到待替换文本：' + find.slice(0, 120) }
    if (count > 1 && edit.replaceAll !== true) {
      return { ok: false, code: 'EDIT_AMBIGUOUS', message: '待替换文本出现 ' + count + ' 次，请扩大上下文或设置 replaceAll: true', matches: count }
    }
    const raw = typeof edit.replace === 'string' ? edit.replace : ''
    out = edit.replaceAll === true ? out.split(find).join(raw) : out.replace(find, () => raw)
    applied.push({ find: find.slice(0, 120), replace: raw.slice(0, 120), occurrences: edit.replaceAll === true ? count : 1 })
  }
  return { ok: true, text: out, applied }
}

/** Normalize tool args into an edit list (accepts `edits` or a single find/replace). */
export function normalizeEdits(args) {
  if (Array.isArray(args.edits) && args.edits.length > 0) return args.edits
  if (typeof args.find === 'string') return [{ find: args.find, replace: args.replace, replaceAll: args.replaceAll === true }]
  return []
}

/** Minimal unified-style diff (common prefix/suffix trim, no LCS). */
export function simpleDiff(beforeText, afterText) {
  const a = String(beforeText ?? '').split('\n')
  const b = String(afterText ?? '').split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length - 1
  let endB = b.length - 1
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--
    endB--
  }
  const header = '@@ -' + (start + 1) + ',' + Math.max(0, endA - start + 1) + ' +' + (start + 1) + ',' + Math.max(0, endB - start + 1) + ' @@'
  const lines = [header]
  for (let i = start; i <= endA; i++) lines.push('- ' + a[i])
  for (let i = start; i <= endB; i++) lines.push('+ ' + b[i])
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// bridge to the harness
// ---------------------------------------------------------------------------

/** Pull an on-disk image path out of a `read_pdf` value. */
export function findImagePath(value) {
  const candidates = []
  for (const img of (value && value.ordered_images) || []) if (img && img.path) candidates.push(img.path)
  for (const img of (value && value.inlined_images) || []) if (img && img.path) candidates.push(img.path)
  for (const file of (value && value.files) || []) for (const artifact of (file && file.artifacts) || []) if (artifact && artifact.path) candidates.push(artifact.path)
  if (value && typeof value.path === 'string') candidates.push(value.path)
  return candidates.find((p) => /\.(png|jpe?g|webp|gif)$/i.test(String(p))) || null
}

/**
 * Build the `callReadPdf` bridge injected into core/render.js.
 * Uses the registered `read_pdf` definition directly; returns null when the
 * tool is absent so render.js can fall through to safeguard 4.
 */
export function makeCallReadPdf(ctx, config) {
  const toolName = config.readPdfToolName || 'read_pdf'
  return async function callReadPdf({ pdfPath, page }) {
    const toolsService = ctx && ctx.tools
    if (!toolsService || typeof toolsService.get !== 'function') return null
    const definition = toolsService.get(toolName)
    if (!definition || typeof definition.execute !== 'function') return null
    const value = await definition.execute({ view: 'page', file_path: pdfPath, page }, {})
    const imagePath = findImagePath(value)
    if (imagePath) return { path: imagePath, mediaType: 'image/png' }
    return null
  }
}

/** Persist rendered pages into the durable attachment store when available. */
export async function attachPageImages(ctx, pages, limit) {
  let service
  try {
    service = ctx && typeof ctx.get === 'function' ? ctx.get('attachments') : undefined
  } catch {
    service = undefined
  }
  if (!service || typeof service.saveImage !== 'function' || !Array.isArray(pages)) return []
  const attached = []
  for (const page of pages.slice(0, Math.max(0, limit))) {
    if (!page || !page.path) continue
    try {
      const data = fs.readFileSync(page.path)
      const attachment = await service.saveImage({ data, mediaType: 'image/png', name: path.basename(page.path) })
      attached.push({ index: page.index, attachment, path: page.path })
    } catch {
      /* an attachment failure must not fail the inspection */
    }
  }
  return attached
}

/**
 * Port of PaperFit's `detect_column_void.py` into the inspection result.
 *
 * Returns candidates, never verdicts. The caller (the model) inspects the page
 * image and decides; per `agents/layout-detective-agent.md` a rejected candidate
 * is a false positive, not a defect.
 *
 * @param {Array<{path: string|null, index: number|null}>} renderedPages - pages on disk.
 * @param {{columnType?: string}} [options] - column layout hint.
 * @returns {{available: boolean, reason: string|null, pages: Array<object>, a5CandidatePages: number[], byDefect: object}}
 */
export function collectMachineSignals(renderedPages, options = {}) {
  const available = Array.isArray(renderedPages) && renderedPages.length > 0
  if (!available) {
    return { available: false, reason: '没有页图可供机检', pages: [], a5CandidatePages: [], byDefect: {} }
  }
  const pages = []
  const candidatePages = new Set()
  for (const page of renderedPages) {
    if (!page || !page.path) continue
    let buffer
    try {
      buffer = fs.readFileSync(page.path)
    } catch (error) {
      pages.push({ index: page.index, ok: false, reason: 'READ_FAILED: ' + String((error && error.message) || error), a5_candidates: [] })
      continue
    }
    const report = analyzePageImage(buffer, { pageImage: path.basename(page.path), layout: options.columnType === 'double' ? 'double' : 'single' })
    if (!report.ok) {
      pages.push({ index: page.index, ok: false, reason: report.reason, a5_candidates: [] })
      continue
    }
    // A5 is defined for two-column layouts only; for single-column pages the
    // detector already returns no candidates and no column split, so there is
    // nothing to filter here.
    const a5 = report.a5_candidates
    if (a5.length > 0 && Number.isFinite(page.index)) candidatePages.add(page.index)
    pages.push({
      index: page.index,
      ok: true,
      layout: report.layout,
      width: report.width,
      height: report.height,
      inkRatio: report.ink_ratio,
      trailingBlankRatio: report.trailing_blank_ratio,
      contentBox: report.content_box,
      estimatedLineHeightPx: report.estimated_line_height_px,
      splitX: report.split_x,
      columns: report.columns,
      a5_candidates: a5,
    })
  }
  return {
    available: true,
    reason: null,
    pages,
    a5CandidatePages: [...candidatePages].sort((a, b) => a - b),
    byDefect: { A5: { detector: 'detect_column_void', candidates: pages.reduce((n, p) => n + (p.a5_candidates ? p.a5_candidates.length : 0), 0) } },
  }
}

/** Wrap a tool body so an unexpected failure becomes a structured result. */
async function attempt(tool, fn) {  try {
    return await fn()
  } catch (error) {
    if (error && error.name === 'PathError') {
      return { ok: false, error: { code: 'INVALID_PATH', tool, message: String(error.message) }, advice: ['工具入参一律使用工作区相对路径（不含盘符、不以 / 或 \\\\ 开头、不含 ..）。'] }
    }
    return {
      ok: false,
      error: { code: 'VTO_TOOL_FAILED', tool, message: String((error && error.message) || error) },
      advice: '这是一个内部错误；请检查参数路径是否存在，并把该消息报告给插件维护者。',
    }
  }
}

const line = (label, value) => (value === undefined || value === null || value === '' ? null : '- ' + label + '：' + value)
const textBlock = (text) => [{ type: 'text', text }]
const joinLines = (items) => items.filter(Boolean).join('\n')

/**
 * One-line summary of the machine-detected candidates, or null when there are none.
 *
 * Kept deliberately terse and *non-committal*: it reports what the detector
 * measured, not that a defect exists. The wording says "候选" because the model
 * still has to confirm against the page image (layout-detective contract).
 * @param {{available?: boolean, a5CandidatePages?: number[], pages?: Array<object>}|undefined} signals - machine signals.
 * @returns {string|null} summary line.
 */
export function machineSignalLine(signals) {
  if (!signals || !signals.available) return signals && signals.reason ? '🔧 机检：跳过（' + signals.reason + '）' : null
  const analysed = (signals.pages || []).filter((p) => p && p.ok).length
  const candidates = (signals.pages || []).reduce((n, p) => n + ((p && p.a5_candidates) ? p.a5_candidates.length : 0), 0)
  if (candidates === 0) return '🔧 机检：' + analysed + ' 页，无 A5 列空洞候选'
  const detail = (signals.pages || [])
    .filter((p) => p && p.a5_candidates && p.a5_candidates.length > 0)
    .map((p) => '第 ' + p.index + ' 页 ' + p.a5_candidates.map((c) => c.column + ' ' + (c.void_ratio_of_column * 100).toFixed(0) + '%').join('/'))
    .join('，')
  return '🔧 机检：' + analysed + ' 页，A5 候选 ' + candidates + ' 处（' + detail + '）'
}

/** Resolve the project/workDir/state triple a tool needs. */
function context(ctx, exec, config, args) {
  const projectDir = resolveProjectDir(ctx, exec, config, args.dir)
  const workDir = resolveWorkDir(projectDir, args.workDir || config.workDir)
  const loaded = loadStateSafe(workDir)
  const state = loaded.state
  const entry = args.entry || (state && state.entry) || null
  return { projectDir, workDir, state, statePath: loaded.path, stateError: loaded.error, entry }
}

// ---------------------------------------------------------------------------
// vto_start
// ---------------------------------------------------------------------------

function buildVtoStart(ctx, config) {
  return defineTool({
    name: 'vto_start',
    description:
      'VTO 第一步：解析工程目录并建立基线。写 <workDir>/state.json，冻结内容基线（\\cite/\\label/\\ref/\\caption 键 + 每文件 sha256），并记录 PDF 页数基线。所有路径为工作区相对路径。',
    parameters: {
      dir: { type: 'string', description: '工作区相对工程目录，默认 "."' },
      entry: { type: 'string', description: '入口 tex（相对工程目录），默认自动探测 main.tex' },
      pageBudget: { type: 'number', description: '目标页数（A3/E2 页数预算）' },
      template: { type: 'string', description: '模板标识，例如 ieeetran / acmart' },
      columnType: { type: 'string', description: 'single 或 double，默认自动探测' },
      workDir: { type: 'string', description: '工作目录名，默认取 config.workDir' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) =>
        textBlock(
          joinLines([
            value.ok ? '✅ VTO 基线已建立' : '⛔ VTO 基线建立失败：' + (value.error ? value.error.message : ''),
            line('工程目录', value.projectDir),
            line('工作目录', value.workDir),
            line('入口', value.entry),
            line('栏式', value.columnType),
            line('页数预算', value.pageBudget),
            line('PDF', value.pdf && value.pdf.status === 'ok' ? value.pdf.path + '（' + value.pdf.pages + ' 页）' : value.pdf && value.pdf.reason),
            value.baseline ? line('内容基线', value.baseline.files + ' 个 tex / ' + value.baseline.cites + ' cite / ' + value.baseline.labels + ' label / ' + value.baseline.refs + ' ref') : null,
            ...(value.advice || []).map((a) => '💡 ' + a),
          ])
        ),
    },
    async execute(args, exec) {
      return attempt('vto_start', async () => {
        const { projectDir, workDir } = context(ctx, exec, config, args)
        if (!fs.existsSync(projectDir)) {
          return { ok: false, projectDir, workDir, error: { code: 'DIR_NOT_FOUND', message: '工程目录不存在：' + projectDir }, advice: ['检查 dir 参数是否为工作区相对路径。'] }
        }
        const sources = collectTexSources(projectDir)
        if (sources.length === 0) {
          return { ok: false, projectDir, workDir, error: { code: 'NO_TEX', message: '未找到 .tex 文件' }, advice: ['确认 dir 指向 LaTeX 工程根目录。'] }
        }
        const entry = args.entry ? safeRel(args.entry, 'entry') : detectEntry(projectDir)
        const columnType = args.columnType === 'double' || args.columnType === 'single' ? args.columnType : inferColumnType(sources)
        const pageBudget = Number.isFinite(Number(args.pageBudget)) ? Number(args.pageBudget) : config.pageBudget

        const baseline = snapshot(sources)
        const state = newState({
          dir: projectDir,
          workDir: args.workDir || config.workDir,
          entry,
          pageBudget,
          template: args.template || null,
          columnType,
          uploadScope: config.uploadScope,
          maxRounds: DEFAULT_MAX_ROUNDS,
        })
        state.baseline = baseline
        state.status = 'baseline'
        const statePath = saveState(workDir, state)

        const advice = []
        const pdfPath = findPdf(projectDir, workDir, entry)
        let pdf
        if (pdfPath) {
          const info = await countPdfPages(pdfPath)
          pdf = {
            status: info.pages ? 'ok' : 'skipped',
            path: path.relative(projectDir, pdfPath),
            pages: info.pages,
            source: info.source,
            reason: info.pages ? null : '无法读取页数：' + (info.error || '未知原因'),
          }
          if (info.pages && pageBudget && info.pages !== pageBudget) advice.push('当前 PDF ' + info.pages + ' 页，与页数预算 ' + pageBudget + ' 不一致（A3/E2）。')
        } else {
          pdf = { status: 'skipped', path: null, pages: null, reason: '未找到已编译 PDF' }
          advice.push('未找到 PDF：先编译（latex_build）再运行 vto_inspect 取页图。')
        }
        return {
          ok: true,
          projectDir,
          workDir,
          entry,
          columnType,
          pageBudget,
          statePath,
          round: state.round,
          pdf,
          baseline: {
            at: baseline.at,
            files: baseline.files.length,
            cites: baseline.protected.cites.length,
            labels: baseline.protected.labels.length,
            refs: baseline.protected.refs.length,
            captions: baseline.protected.captions.length,
          },
          advice,
        }
      })
    },
  })
}

// ---------------------------------------------------------------------------
// vto_inspect
// ---------------------------------------------------------------------------

function buildVtoInspect(ctx, config) {
  return defineTool({
    name: 'vto_inspect',
    description:
      'VTO 视觉检查：按 config.rendererOrder 渲染页图（poppler → miktex-ghostscript → mineru-page），返回逐页页图 ContentBlock、18 项缺陷 checklist（含 layout_rules 数值阈值）与 machineSignals 机检候选（A5 列空洞，PaperFit detect_column_void 的移植）。机检只是候选，判据仍是页图。无可用后端时返回 skipped + 安装建议，并降级为「只给 checklist」。',
    parameters: {
      dir: { type: 'string', description: '工作区相对工程目录，默认 "."' },
      pdf: { type: 'string', description: '工作区相对 PDF 路径，默认自动探测' },
      pages: { type: 'string', description: '页码：all / 3 / 1-3,5（默认 all）' },
      dpi: { type: 'number', description: '渲染 DPI，默认 150' },
      focus: { type: 'string', description: '只看指定缺陷 id 或类别，如 "A5,B1" 或 "A,B"' },
      parse: { type: 'boolean', description: '是否请求 read_pdf 结构化解析（可能上传，受 uploadScope 约束）' },
      consent: { type: 'boolean', description: 'external-only 下显式同意上传本文档' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const blocks = textBlock(
          joinLines([
            value.status === 'ok' ? '✅ 页图渲染完成（' + value.render.backend + '）' : value.status === 'failed' ? '⚠️ 页图部分失败：' + (value.render.reason || '') : '⛔ 页图不可用：' + (value.render.reason || ''),
            line('PDF', value.pdfPath),
            line('页数', value.metrics.pageCount),
            line('已渲染', value.pages.length + ' 页' + (value.metrics.dpi ? ' @ ' + value.metrics.dpi + 'dpi' : '')),
            line('checklist', value.checklist.length + ' 项'),
            line('PDF 解析闸门', describeGate(value.gate)),
            ...(value.render.advice ? ['💡 ' + value.render.advice] : []),
            ...(value.notes || []).map((n) => '💡 ' + n),
            machineSignalLine(value.machineSignals),
            value.pages.length > 0 ? '逐页请用 read_image 查看：' + value.pages.map((p) => p.index).join(', ') : null,
            value.machineSignals && value.machineSignals.available ? '机检只是候选：请逐页看图确认；若看图后否定某候选，请把它记为误报而不是缺陷。' : null,
          ])
        )
        for (const image of value.images || []) {
          if (image && image.attachment) blocks.push({ type: 'image', attachment: image.attachment })
        }
        return blocks
      },
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return attempt('vto_inspect', async () => {
        const base = context(ctx, exec, config, args)
        const { projectDir, workDir } = base
        const state = base.state
        const entry = base.entry
        const dpi = Number.isFinite(Number(args.dpi)) ? Number(args.dpi) : 150

        let pdfPath = null
        if (args.pdf) pdfPath = path.resolve(projectDir, safeRel(args.pdf, 'pdf'))
        else pdfPath = findPdf(projectDir, workDir, entry)

        const columnType = (state && state.columnType) || inferColumnType(collectTexSources(projectDir, { maxFiles: 50 }))
        const checklist = buildChecklist({ columnType, focus: args.focus ?? null })

        if (!pdfPath) {
          return {
            status: 'skipped',
            pdfPath: null,
            pages: [],
            checklist,
            metrics: { pageCount: null, dpi: null, rendered: 0 },
            images: [],
            gate: checkPdfRead(config, { view: 'page' }),
            render: { status: 'skipped', backend: null, reason: '未找到 PDF', advice: '先运行 latex_build 生成 PDF（例如 main.pdf），再用 vto_inspect。' },
            notes: ['视觉通道不可用：已降级为「只给 checklist」的人工核对清单。'],
          }
        }

        const gate = checkPdfRead(config, {
          view: args.parse === true ? 'content' : 'page',
          isUserWork: true,
          consent: args.consent === true,
          source: path.basename(pdfPath),
        })
        const notes = []
        if (args.parse === true && !gate.allowed) {
          notes.push('结构化解析被 uploadScope 拦截：' + gate.reason + (gate.advice ? ' ' + gate.advice : ''))
        }

        const rendered = await renderPages({
          pdfPath,
          pages: args.pages ?? 'all',
          dpi,
          outDir: path.join(workDir, 'pages'),
          config,
          callReadPdf: makeCallReadPdf(ctx, config),
          signal: exec && exec.signal,
        })

        if (rendered.status !== 'ok') {
          notes.push('未成功产出页图：' + (rendered.reason || ''))
          notes.push('已降级为「只给 checklist」的人工核对清单。')
        }

        const pages = rendered.pages.map((page) => ({
          index: page.index,
          call: page.path ? 'read_image({"file_path":' + JSON.stringify(path.relative(projectDir, page.path)) + '})' : null,
          path: page.path ? path.relative(projectDir, page.path) : null,
          width: page.width,
          height: page.height,
          bytes: page.bytes,
        }))

        const images = await attachPageImages(ctx, rendered.pages, config.attachImagesPerRound)
        if (rendered.pages.length > images.length && rendered.status === 'ok') {
          notes.push('本轮仅内联 ' + images.length + ' 张页图（config.attachImagesPerRound）；其余页请用 read_image 按需查看。')
        }

        /**
         * Machine signals (PaperFit `scripts/detect_column_void.py` port).
         *
         * This does NOT replace looking at the page images. PaperFit's
         * `layout-detective-agent` contract is explicit: machine signals are
         * *candidates*, the page image is the arbiter, and a candidate the model
         * rejects on inspection is recorded as a false positive rather than a
         * defect. So this block only measures; the judging stays with the model.
         */
        const machineSignals = collectMachineSignals(rendered.pages, { columnType })

        return {
          status: rendered.status,
          pdfPath: path.relative(projectDir, pdfPath),
          pages,
          checklist,
          machineSignals,
          metrics: { pageCount: rendered.pageCount ?? rendered.pages.length ?? null, dpi, rendered: rendered.pages.length, backend: rendered.backend },
          images,
          gate,
          render: { status: rendered.status, backend: rendered.backend, reason: rendered.reason ?? null, advice: rendered.advice ?? null, attempts: rendered.attempts ?? [] },
          notes,
        }
      })
    },
  })
}

// ---------------------------------------------------------------------------
// vto_fix
// ---------------------------------------------------------------------------

function buildVtoFix(ctx, config) {
  return defineTool({
    name: 'vto_fix',
    description:
      'VTO 修复：默认 apply:false 只给出配方 + diff + 策略/守卫预检结果；apply:true 时执行「备份 → 写入 → guard 校验 → 失败回滚」。禁止手法（\\resizebox / 裸 \\vspace / 滥 \\newpage / \\tiny / \\scriptsize）会被拒绝。',
    parameters: {
      dir: { type: 'string', description: '工作区相对工程目录，默认 "."' },
      file: { type: 'string', description: '要修改的工作区相对 tex 文件' },
      find: { type: 'string', description: '待替换原文（精确匹配）' },
      replace: { type: 'string', description: '替换文本' },
      replaceAll: { type: 'boolean', description: '允许多处替换，默认 false' },
      edits: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '批量编辑：[{find, replace, replaceAll}]' },
      apply: { type: 'boolean', description: '是否真正写入，默认 false' },
      round: { type: 'number', description: '轮次号，默认取 state.round（或 1）' },
      rationale: { type: 'string', description: '修复理由（写入轮次记录）' },
      force: { type: 'boolean', description: '忽略策略/守卫告警（危险，默认 false）' },
      allowPolicy: { type: 'array', items: { type: 'string' }, description: '显式豁免的 FORBIDDEN rule id' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) =>
        textBlock(
          joinLines([
            value.applied ? '✅ 已写入并校验通过：' + value.file : value.ok ? '📝 修复配方（未写入）：' + value.file : '⛔ 修复被拒绝：' + (value.error ? value.error.message : ''),
            value.diff ? FENCE + 'diff\n' + value.diff + '\n' + FENCE : null,
            ...describeViolations(value.violations || []).map((v) => '🚫 ' + v),
            ...((value.contentIntegrity && value.contentIntegrity.protectedLost) || []).map((p) => '🚫 受保护内容丢失：' + p),
            value.contentIntegrity && value.contentIntegrity.ok === false && (!value.contentIntegrity.protectedLost || value.contentIntegrity.protectedLost.length === 0)
              ? '🚫 文件被删除：' + (value.contentIntegrity.removed || []).join(', ')
              : null,
            value.rolledBack ? '↩️ 校验失败，已回滚到修复前状态。' : null,
            value.secrets && value.secrets.length > 0 ? '🔑 检出疑似密钥 ' + value.secrets.length + ' 处：' + value.secrets.map((s) => s.pattern + '@' + s.line).join(', ') : null,
            ...(value.advice || []).map((a) => '💡 ' + a),
          ])
        ),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return attempt('vto_fix', async () => {
        const { projectDir, workDir, state } = context(ctx, exec, config, args)
        const rel = safeRel(args.file, 'file')
        const target = resolveInside(projectDir, rel)
        const full = target.abs
        /**
         * Early-refusal envelope: every vto_fix result carries the same keys, so a
         * model consumer never has to guess whether a field is absent or false.
         */
        const refuse = (code, message, extra = {}) => ({
          ok: false,
          applied: false,
          file: rel,
          round: null,
          rolledBack: false,
          backups: [],
          violations: [],
          contentIntegrity: null,
          secrets: [],
          diff: null,
          error: { code, message, ...extra },
          advice: [],
        })
        if (!target.inside) {
          return refuse('PATH_ESCAPE', 'file 超出工程目录：' + rel)
        }
        let before
        try {
          before = fs.readFileSync(full, 'utf8')
        } catch (error) {
          return refuse('FILE_NOT_READABLE', String((error && error.message) || error))
        }

        const edits = normalizeEdits(args)
        if (edits.length === 0) {
          const out = refuse('NO_EDITS', '需要 find/replace 或 edits')
          out.advice.push('提供精确的 find 文本（含足够上下文以保证唯一匹配）。')
          return out
        }
        const editResult = applyEdits(before, edits)
        if (!editResult.ok) {
          const out = refuse(editResult.code, editResult.message, { matches: editResult.matches })
          out.advice.push('扩大 find 上下文，或用 edits 批量替换。')
          return out
        }
        const after = editResult.text
        if (after === before) {
          return refuse('NO_CHANGE', '替换后内容未变化')
        }

        const policy = checkPolicy(before, after, { skip: args.allowPolicy })
        const sourcesBefore = collectTexSources(projectDir)
        const baseline = snapshot(sourcesBefore)
        const sourcesAfter = sourcesBefore.map((s) => (s.path === rel ? { path: s.path, text: after } : s))
        const integrity = verifySnapshot(baseline, sourcesAfter)
        const secrets = scanSecrets(after)
        const diff = simpleDiff(before, after)
        const round = Number.isFinite(Number(args.round)) ? Number(args.round) : state && state.round ? Number(state.round) : 1

        const blockers = []
        if (!policy.ok) blockers.push('策略违规 ' + policy.violations.length + ' 处：禁止使用 ' + [...new Set(policy.violations.map((v) => v.id))].join(', '))
        if (!integrity.ok) blockers.push('内容完整性校验失败：' + (integrity.protectedLost.join(', ') || '文件被删除 ' + integrity.removed.join(', ')))

        const result = {
          ok: policy.ok && integrity.ok,
          applied: false,
          file: rel,
          round,
          diff,
          violations: policy.violations,
          policyCounts: policy.counts,
          contentIntegrity: { ok: integrity.ok, protectedLost: integrity.protectedLost, removed: integrity.removed, warnings: integrity.warnings },
          secrets,
          backups: [],
          rolledBack: false,
          recipe: edits.map((e) => ({ find: String(e.find).slice(0, 200), replace: String(e.replace ?? '').slice(0, 200), replaceAll: e.replaceAll === true })),
          advice: [],
        }

        if (args.apply !== true) {
          result.advice.push('这是预检结果（apply:false）。确认 diff 与校验结论后再用 apply:true 写入。')
          if (blockers.length > 0) result.advice.push('存在阻断项：' + blockers.join('；') + '。请改用允许的排版手法。')
          return result
        }

        if (blockers.length > 0 && args.force !== true) {
          result.error = { code: 'BLOCKED_BY_GUARD', message: blockers.join('；') }
          result.advice.push('修复被拒绝（不会写入）。请改用允许的手法；确需强制时显式传 force:true 并说明理由。')
          return result
        }

        const backups = backupFiles(workDir, round, [rel], { projectRoot: projectDir })
        try {
          fs.mkdirSync(path.dirname(full), { recursive: true })
          fs.writeFileSync(full, after, 'utf8')
        } catch (error) {
          result.error = { code: 'WRITE_FAILED', message: String((error && error.message) || error) }
          const restored = rollback(workDir, round)
          result.rolledBack = restored.length > 0
          result.advice.push('写入失败，已尝试回滚。')
          return result
        }

        const verifyAfter = verifySnapshot(baseline, collectTexSources(projectDir))
        if (!verifyAfter.ok) {
          const restored = rollback(workDir, round)
          result.applied = false
          result.rolledBack = restored.length > 0
          result.contentIntegrity = { ok: false, protectedLost: verifyAfter.protectedLost, removed: verifyAfter.removed, warnings: verifyAfter.warnings }
          result.error = { code: 'ROLLED_BACK', message: '写入后 guard 校验失败：' + (verifyAfter.protectedLost.join(', ') || verifyAfter.removed.join(', ')) }
          result.advice.push('已回滚。请缩小改动范围，确保不删除任何 \\cite/\\label/\\ref/\\caption。')
          return result
        }

        result.applied = true
        result.backups = backups
        result.contentIntegrity = { ok: true, protectedLost: [], removed: [], warnings: verifyAfter.warnings, numericDrift: verifyAfter.drift.numericTokens }
        try {
          recordRound(workDir, round, {
            action: 'fix',
            file: rel,
            rationale: args.rationale ?? null,
            edits: result.recipe,
            diff,
            violations: policy.violations,
            policyAfter: { [rel]: after },
            backups,
          })
        } catch (error) {
          result.advice.push('轮次记录写入失败（不影响修复）：' + String((error && error.message) || error))
        }
        result.advice.push('已写入并留档。下一步：vto_verify 复核编译/渲染/内容完整性/页数预算/策略。')
        return result
      })
    },
  })
}

// ---------------------------------------------------------------------------
// vto_verify
// ---------------------------------------------------------------------------

function buildVtoVerify(ctx, config) {
  return defineTool({
    name: 'vto_verify',
    description:
      'VTO 复核：检查编译、页图渲染、内容完整性（guard 基线对比）、页数预算与策略，给出 verdict、checks 五项、regressions 与需要回滚时的 rollbackTo。',
    parameters: {
      dir: { type: 'string', description: '工作区相对工程目录，默认 "."' },
      entry: { type: 'string', description: '入口 tex，默认取 state 或自动探测' },
      pdf: { type: 'string', description: '工作区相对 PDF 路径，默认自动探测' },
      pages: { type: 'string', description: '渲染页码，默认 "1"（复核抽样页）' },
      pageBudget: { type: 'number', description: '覆盖 state 中的页数预算' },
      round: { type: 'number', description: '轮次号，默认 state.round' },
      dpi: { type: 'number', description: '渲染 DPI，默认 120' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) =>
        textBlock(
          joinLines([
            value.verdict === 'pass' ? '✅ verdict: pass' : value.verdict === 'pass_with_notes' ? '🟡 verdict: pass_with_notes' : value.verdict === 'skipped' ? '➖ verdict: skipped' : '⛔ verdict: ' + value.verdict,
            line('compile', value.checks.compile.status + (value.checks.compile.reason ? '（' + value.checks.compile.reason + '）' : '')),
            line('render', value.checks.render.status + (value.checks.render.backend ? '（' + value.checks.render.backend + '）' : '')),
            line('contentIntegrity', value.checks.contentIntegrity.status + (value.checks.contentIntegrity.reason ? '（' + value.checks.contentIntegrity.reason + '）' : '')),
            line('pageBudget', value.checks.pageBudget.status + (value.checks.pageBudget.detail ? '（' + value.checks.pageBudget.detail + '）' : '')),
            line('policy', value.checks.policy.status),
            ...(value.regressions || []).map((r) => '⚠️ 回归：' + r),
            value.rollbackTo ? '↩️ 建议回滚到第 ' + value.rollbackTo + ' 轮（backups/r' + value.rollbackTo + '）' : null,
            ...(value.advice || []).map((a) => '💡 ' + a),
          ])
        ),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return attempt('vto_verify', async () => {
        const { projectDir, workDir, state } = context(ctx, exec, config, args)
        const entry = args.entry || (state && state.entry) || detectEntry(projectDir)
        const round = Number.isFinite(Number(args.round)) ? Number(args.round) : state && state.round ? Number(state.round) : 1
        const advice = []
        const sources = collectTexSources(projectDir)

        const baseline = state && state.baseline ? state.baseline : null
        const integrity = verifySnapshot(baseline, sources)
        const contentIntegrity = {
          status: !baseline ? 'skipped' : integrity.ok ? 'pass' : 'fail',
          ok: integrity.ok,
          protectedLost: integrity.protectedLost,
          unchanged: integrity.unchanged,
          changed: integrity.changed,
          added: integrity.added,
          removed: integrity.removed,
          warnings: integrity.warnings,
          reason: baseline ? null : 'state.json 中没有基线（先运行 vto_start）',
        }
        if (!baseline) advice.push('没有内容基线：先运行 vto_start，guard 才能拦截「删掉 \\cite 键」这类破坏。')

        let compile = { status: 'skipped', reason: 'lib/core/compile.js 不可用', pages: null, engine: null }
        try {
          const mod = await import('../core/compile.js')
          if (typeof mod.build === 'function') {
            const built = await mod.build({ dir: projectDir, entry, engine: 'auto', config })
            compile = {
              status: built.status,
              engine: built.engine ?? null,
              pages: built.pages ?? null,
              passes: built.passes ?? null,
              durationMs: built.durationMs ?? null,
              pdfPath: built.pdfPath ?? null,
              errors: (built.errors || []).length,
              warnings: (built.warnings || []).length,
              reason: built.reason ?? null,
            }
          }
        } catch (error) {
          compile = { status: 'skipped', reason: '编译模块不可用：' + String((error && error.message) || error), pages: null, engine: null }
          advice.push('编译检查已跳过（A 线模块缺失或未启用）。')
        }

        let pdfPath = null
        if (args.pdf) pdfPath = path.resolve(projectDir, safeRel(args.pdf, 'pdf'))
        else pdfPath = compile.pdfPath || findPdf(projectDir, workDir, entry)
        const rendered = await renderPages({
          pdfPath: pdfPath || path.join(projectDir, '__no_pdf__.pdf'),
          pages: args.pages ?? '1',
          dpi: Number.isFinite(Number(args.dpi)) ? Number(args.dpi) : 120,
          outDir: path.join(workDir, 'pages'),
          config,
          callReadPdf: makeCallReadPdf(ctx, config),
          signal: exec && exec.signal,
        })
        const render = { status: rendered.status, backend: rendered.backend, reason: rendered.reason ?? null, advice: rendered.advice ?? null }
        if (rendered.status !== 'ok') advice.push('渲染未通过：' + (rendered.reason || '未知原因') + '；视觉复核降级为 checklist。')

        let pageCount = rendered.pageCount ?? (rendered.pages.length > 0 ? rendered.pages.length : null)
        if (pageCount === null && pdfPath) {
          const info = await countPdfPages(pdfPath)
          pageCount = info.pages
        }
        if (pageCount === null && Number.isFinite(Number(compile.pages))) pageCount = Number(compile.pages)
        const budgetCandidate = args.pageBudget !== undefined && args.pageBudget !== null ? args.pageBudget : state && state.pageBudget !== undefined && state.pageBudget !== null ? state.pageBudget : config.pageBudget
        const budgetNumeric = Number(budgetCandidate)
        const budget = budgetCandidate === null || budgetCandidate === undefined || budgetCandidate === '' || !Number.isFinite(budgetNumeric) || budgetNumeric <= 0 ? null : budgetNumeric
        const pageBudget = { status: 'skipped', target: budget ?? null, actual: pageCount, detail: null }
        if (budget === null) pageBudget.detail = '未设置页数预算'
        else if (pageCount === null) pageBudget.detail = '无法读取实际页数'
        else if (Number(pageCount) === Number(budget)) {
          pageBudget.status = 'pass'
          pageBudget.detail = pageCount + '/' + budget
        } else {
          pageBudget.status = 'fail'
          pageBudget.detail = '实际 ' + pageCount + ' 页 ≠ 预算 ' + budget + ' 页'
        }

        const previous = latestRoundRecord(workDir, round)
        let policy = { status: 'skipped', violations: [], reason: '没有轮次记录可作对比基线' }
        if (previous && previous.policyAfter && typeof previous.policyAfter === 'object') {
          const violations = []
          for (const source of sources) {
            const key = source.path.split(BS_RE).join('/')
            const baseText = previous.policyAfter[source.path] ?? previous.policyAfter[key]
            if (typeof baseText !== 'string') continue
            for (const violation of checkPolicy(baseText, source.text).violations) violations.push({ ...violation, file: source.path })
          }
          policy = { status: violations.length === 0 ? 'pass' : 'fail', violations, reason: null, baselineRound: previous.round }
        } else {
          advice.push('策略对比基线缺失（还没有 apply:true 的修复记录）；本轮退化为全量静态扫描。')
          policy.violations = checkPolicy('', sources.map((s) => s.text).join('\n')).violations.map((v) => v)
          policy.status = policy.violations.length === 0 ? 'pass' : 'fail'
        }

        const checks = { compile, render, contentIntegrity, pageBudget, policy }
        const regressions = []
        if (previous) {
          if (Number.isFinite(Number(previous.pageCount)) && Number.isFinite(Number(pageCount)) && Number(pageCount) > Number(previous.pageCount)) {
            regressions.push('页数增加：' + previous.pageCount + ' → ' + pageCount)
          }
          if (previous.integrityOk !== false && integrity.ok === false) regressions.push('本轮出现内容完整性回归')
        }

        let verdict = 'pass'
        if (contentIntegrity.status === 'fail' || compile.status === 'failed' || policy.status === 'fail' || pageBudget.status === 'fail') verdict = 'fail'
        else if (contentIntegrity.status === 'skipped' || render.status !== 'ok' || compile.status === 'skipped' || pageBudget.status === 'skipped') verdict = 'pass_with_notes'
        if (regressions.length > 0 && verdict === 'pass') verdict = 'pass_with_notes'

        const rollbackTo = verdict === 'fail' && fs.existsSync(path.join(workPaths(workDir).backups, 'r' + round)) ? round : null
        if (rollbackTo) advice.push('如需回滚：backupFiles/rollback 使用 backups/r' + rollbackTo + ' 的清单恢复文件。')

        try {
          recordRound(workDir, round, { action: 'verify', verdict, checks, pageCount, integrityOk: integrity.ok, regressions })
        } catch (error) {
          advice.push('轮次记录写入失败：' + String((error && error.message) || error))
        }

        return { verdict, round, checks, regressions, rollbackTo, metrics: { pageCount, engine: compile.engine, backend: rendered.backend }, advice }
      })
    },
  })
}

// ---------------------------------------------------------------------------
// vto_report
// ---------------------------------------------------------------------------

function buildVtoReport(ctx, config) {
  return defineTool({
    name: 'vto_report',
    description: 'VTO 报告：把本轮结果写入 <workDir>/reports/round-<n>.{md,json}，正文由 lib/data/diagnostic_report.template.md 渲染。',
    parameters: {
      dir: { type: 'string', description: '工作区相对工程目录，默认 "."' },
      round: { type: 'number', description: '轮次号，默认 state.round（或 1）' },
      verdict: { type: 'string', description: '本轮结论：pass / pass_with_notes / fail / continue' },
      changes: { type: 'array', items: { type: 'string' }, description: '本轮修改摘要（每条一行）' },
      remaining: { type: 'array', items: { type: 'string' }, description: '剩余缺陷（id 或说明）' },
      defectsBefore: { type: 'object', additionalProperties: true, description: '初始缺陷计数，如 {"A1":3}' },
      defectsAfter: { type: 'object', additionalProperties: true, description: '剩余缺陷计数' },
      notes: { type: 'string', description: '补充说明' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) =>
        textBlock(
          joinLines([
            value.ok ? '✅ 报告已写入' : '⛔ 报告写入失败：' + (value.error ? value.error.message : ''),
            line('Markdown', value.mdPath),
            line('JSON', value.jsonPath),
            line('模板', value.template ? value.template.source : null),
            value.unresolvedPlaceholders && value.unresolvedPlaceholders.length > 0 ? '⚠️ 未填充占位符：' + value.unresolvedPlaceholders.join(', ') : null,
          ])
        ),
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      return attempt('vto_report', async () => {
        const { projectDir, workDir, state } = context(ctx, exec, config, args)
        const round = Number.isFinite(Number(args.round)) ? Number(args.round) : state && state.round ? Number(state.round) : 1
        const previous = latestRoundRecord(workDir, round)
        const verdict = args.verdict || (previous && previous.verdict) || (state && state.status) || 'INIT'
        const data = {
          verdict,
          statusLine: verdict,
          changes: Array.isArray(args.changes) ? args.changes : previous && previous.action === 'fix' ? [previous.diff] : [],
          remainingDefects: Array.isArray(args.remaining) ? args.remaining : [],
          defectsBefore: args.defectsBefore ?? undefined,
          defectsAfter: args.defectsAfter ?? {},
          integrity: { preHash: state && state.baseline ? state.baseline.at : null },
          gate: previous && previous.checks ? previous.checks : undefined,
          conclusion: verdict,
          timestamp: new Date().toISOString(),
        }
        const written = writeRoundReport(workDir, round, data)
        return {
          ok: true,
          round,
          projectDir,
          workDir,
          jsonPath: path.relative(projectDir, written.jsonPath),
          mdPath: path.relative(projectDir, written.mdPath),
          template: written.template,
          unresolvedPlaceholders: [],
        }
      })
    },
  })
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

/**
 * Register the five VTO tools.
 * @param {object} ctx - cordis context providing `ctx.tools`.
 * @param {object} [entryConfig] - patch config.
 * @returns {{registered: string[]}} registration summary.
 */
export function registerVto(ctx, entryConfig = {}) {
  if (typeof defineTool !== 'function') {
    throw new Error('registerVto 需要 @deepseek-ai/dsh-tools：' + (defineToolError || '模块未安装'))
  }
  if (!ctx || !ctx.tools || typeof ctx.tools.register !== 'function') {
    throw new Error('registerVto 需要 ctx.tools（inject: [tools]）')
  }
  const config = normalizeConfig(entryConfig)
  const definitions = [buildVtoStart(ctx, config), buildVtoInspect(ctx, config), buildVtoFix(ctx, config), buildVtoVerify(ctx, config), buildVtoReport(ctx, config)]
  for (const definition of definitions) ctx.tools.register(definition)
  return { registered: definitions.map((d) => d.name) }
}
