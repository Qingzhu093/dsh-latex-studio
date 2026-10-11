/**
 * Static LaTeX linter (pure Node ESM, no DSH imports).
 *
 * Rule set follows INTERFACES §4:
 *  - forbid pseudo-fixes (\resizebox, bare \vspace, \tiny/\scriptsize, \newpage spam);
 *  - reconcile \cite keys against the project .bib and \ref against \label;
 *  - port PaperFit's figure/reference source-order distance heuristic
 *    (scripts/extract_crossrefs.py, MIT);
 *  - optionally attach MiKTeX chktex findings (external channel).
 *
 * Never throws: a missing project or missing chktex degrades to an empty report
 * plus `external.chktex = 'skipped'`.
 * @module dsh-latex-studio/core/lint
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { resolveTool } from './env.js'
import { extractProtected as extractProtectedCore, forbiddenRule } from './rules.js'

/** Commands whose brace argument holds citation keys. */
const CITE_RE = /\\([a-zA-Z]*[Cc]ite[a-zA-Z]*)\*?(?:\[[^\]]*\])*\{([^}]*)\}/g
/** \label{...} */
const LABEL_RE = /\\label\{([^}]*)\}/g
/** \ref / \eqref / \pageref / \autoref / \cref ... */
const REF_RE = /\\([a-zA-Z]*[Rr]ef)\*?(?:\[[^\]]*\])*\{([^}]*)\}/g
/** Numeric tokens that a fix must not silently change. */
const NUMERIC_RE = /(?<![\w.])\d+(?:\.\d+)?%?/g
/** Integer literal used to find a whole file's numbers. */
const SECTION_RE = /\\(section|subsection|subsubsection)\*?\{([^}]*)\}/g
const FIGURE_BEGIN_RE = /\\begin\{figure\}(?:\[[^\]]*\])?/g
const FIGURE_END_RE = /\\end\{figure\}/

const MAX_FINDINGS = 200
const SKIP_DIRS = new Set(['build', 'aux', 'pages', 'backups', 'reports', 'node_modules', '.git', '.latex-studio'])

/** Normalize the accepted texSources shapes into [{path, text}]. */
function normalizeSources(texSources) {
  const out = []
  if (texSources == null) return out
  if (typeof texSources === 'string') {
    out.push({ path: '<string>', text: texSources })
    return out
  }
  if (Array.isArray(texSources)) {
    for (const item of texSources) {
      if (typeof item === 'string') out.push({ path: '<string>', text: item })
      else if (item && typeof item === 'object' && typeof item.text === 'string') {
        out.push({ path: String(item.path ?? '<unknown>'), text: item.text })
      }
    }
    return out
  }
  if (typeof texSources === 'object' && typeof texSources.text === 'string') {
    out.push({ path: String(texSources.path ?? '<unknown>'), text: texSources.text })
  }
  return out
}

/** Split a braced key list ('a, b , c') into trimmed keys. */
function splitKeys(raw) {
  return String(raw ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
}

/** Absolute line number of a regex match inside text. */
function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1
  return line
}

/**
 * Extract the protected inventory that later writes must not silently change.
 * @param {Array<{path?:string,text:string}>|string|{path?:string,text:string}} texSources
 * @returns {{cites:string[], labels:string[], refs:string[], numericTokens:string[]}}
 */
export function extractProtected(texSources) {
  // One extractor for the whole package: lib/core/rules.js. This projection keeps
  // lint's historical shape (four keys) while guard.js exposes the richer one.
  const full = extractProtectedCore(texSources)
  return {
    cites: full.cites,
    labels: full.labels,
    refs: full.refs,
    numericTokens: full.numericTokens,
  }
}

/** Recursively list .tex files under dir (depth-capped, skips generated dirs). */
function listTexFiles(dir, depth = 0) {
  if (depth > 3) return []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...listTexFiles(full, depth + 1))
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.tex') {
      out.push(full)
    }
  }
  return out
}

function listBibKeys(dir) {
  const keys = new Set()
  let names = []
  try {
    names = readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.bib'))
  } catch {
    return keys
  }
  for (const name of names) {
    // A `.bib` entry can be a DIRECTORY (or be locked): an unguarded read would
    // make lintProject throw EISDIR, which contradicts this module's "never
    // throws" contract and hard-fails latex_lint.
    let text
    try {
      text = readFileSync(join(dir, name), 'utf8').replace(/\r\n?/g, '\n')
    } catch {
      continue
    }
    const re = /@([A-Za-z]+)\s*[{(]\s*([^,\s}]+)\s*,/g
    let match
    while ((match = re.exec(text)) !== null) keys.add(match[2])
  }
  return keys
}

/** Section structure: [{line, name}] for the distance heuristic. */
function sectionsOf(text) {
  const out = []
  SECTION_RE.lastIndex = 0
  let match
  while ((match = SECTION_RE.exec(text)) !== null) {
    out.push({ line: lineOf(text, match.index), name: match[2].trim() })
  }
  return out
}

function sectionIndexAt(sections, line) {
  let idx = -1
  for (let i = 0; i < sections.length; i += 1) {
    if (line >= sections[i].line) idx = i
    else break
  }
  return idx
}

/** Rule implementations. Each returns findings for one parsed source. */
const RULES = {
  /** Forbid \resizebox-style table shrinking (pseudo-fix). */
  'no-resizebox': (ctx) => {
    const findings = []
    const re = new RegExp(forbiddenRule('resizebox').pattern.source, 'g')
    let match
    while ((match = re.exec(ctx.text)) !== null) {
      findings.push({
        rule: 'no-resizebox',
        severity: 'critical',
        file: ctx.path,
        line: lineOf(ctx.text, match.index),
        message: '使用 \\resizebox 暴力缩放表格/图片属于伪修复。',
        hint: '改用 tabularx / \\small / 调整列格式或拆分表格，不要缩放整体。',
      })
    }
    return findings
  },
  /** Flag bare \vspace used as a layout crowbar. */
  'bare-vspace': (ctx) => {
    const findings = []
    const lines = ctx.text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (!new RegExp(forbiddenRule('bare-vspace').pattern.source).test(line)) continue
      const stripped = line.replace(new RegExp(forbiddenRule('bare-vspace').pattern.source, 'g'), '').replace(/^\s*%/, '').trim()
      if (stripped !== '') continue
      findings.push({
        rule: 'bare-vspace',
        severity: 'major',
        file: ctx.path,
        line: i + 1,
        message: '裸 \\vspace 撑版面：多数情况下是在掩盖真正的版式问题。',
        hint: '先查是孤行、浮动体还是内容过少；确需调整请用语义化间距（如 \\smallskip 或模板变量）。',
      })
    }
    return findings
  },
  /** Flag tiny/scriptsize used to squeeze content. */
  'tiny-font': (ctx) => {
    const findings = []
    const re = new RegExp(forbiddenRule('tiny-font').pattern.source + '|' + forbiddenRule('scriptsize-font').pattern.source, 'g')
    let match
    while ((match = re.exec(ctx.text)) !== null) {
      findings.push({
        rule: 'tiny-font',
        severity: 'major',
        file: ctx.path,
        line: lineOf(ctx.text, match.index),
        message: '使用 ' + match[0] + ' 缩小字号以塞入内容，可读性不达标。',
        hint: '优先精简文字/表列，或使用模板允许的 \\small 与更宽版式。',
      })
    }
    return findings
  },
  /** Flag \newpage spam. */
  'excess-newpage': (ctx) => {
    const findings = []
    const hits = []
    const re = new RegExp(forbiddenRule('newpage-abuse').pattern.source, 'g')
    let match
    while ((match = re.exec(ctx.text)) !== null) hits.push({ line: lineOf(ctx.text, match.index), cmd: match[0].replace('\\', '') })
    if (hits.length > 3) {
      for (const hit of hits) {
        findings.push({
          rule: 'excess-newpage',
          severity: 'minor',
          file: ctx.path,
          line: hit.line,
          message: '\\' + hit.cmd + ' 频繁出现（本文档共 ' + hits.length + ' 处）。',
          hint: '让浮动体自然排布；确需分页时用 \\clearpage 并确认不是为了凑页数。',
        })
      }
    }
    return findings
  },
  /** \ref without a matching \label. */
  'undefined-ref': (ctx) => {
    const findings = []
    for (const ref of ctx.refs) {
      if (ctx.labels.has(ref.key)) continue
      findings.push({
        rule: 'undefined-ref',
        severity: 'major',
        file: ctx.path,
        line: ref.line,
        message: '\\' + ref.cmd + '{' + ref.key + '} 没有对应的 \\label。',
        hint: '补 \\label{' + ref.key + '}，或修正引用键拼写。',
      })
    }
    return findings
  },
  /** \cite key missing from every project .bib. */
  'cite-not-in-bib': (ctx) => {
    const findings = []
    if (ctx.bibKeys === null) return findings
    for (const cite of ctx.cites) {
      if (cite.key === '*') continue
      if (ctx.bibKeys.has(cite.key)) continue
      findings.push({
        rule: 'cite-not-in-bib',
        severity: 'major',
        file: ctx.path,
        line: cite.line,
        message: '引用键 ' + cite.key + ' 不在项目任何 .bib 中。',
        hint: '补 .bib 条目或修正键名；不要引用不存在的文献。',
      })
    }
    return findings
  },
  /** Same label defined twice. */
  'duplicate-label': (ctx) => {
    const findings = []
    for (const [key, hits] of ctx.labelHits) {
      if (hits.length < 2) continue
      for (const hit of hits.slice(1)) {
        findings.push({
          rule: 'duplicate-label',
          severity: 'critical',
          file: ctx.path,
          line: hit,
          message: '\\label{' + key + '} 重复定义（首次在第 ' + hits[0] + ' 行）。',
          hint: '标签必须唯一，重复会让交叉引用指向随机目标。',
        })
      }
    }
    return findings
  },
  /** Labels that nothing references. */
  'orphan-label': (ctx) => {
    const findings = []
    const allRefs = ctx.projectRefs
    for (const [key, hits] of ctx.labelHits) {
      if (allRefs.has(key)) continue
      findings.push({
        rule: 'orphan-label',
        severity: 'info',
        file: ctx.path,
        line: hits[0],
        message: '\\label{' + key + '} 没有任何 \\ref 引用。',
        hint: '删除无用标签，或补上正文引用。',
      })
    }
    return findings
  },
  /** PaperFit figure/reference source-order distance (fig: labels only). */
  'figure-ref-distance': (ctx) => {
    const findings = []
    const figureMap = new Map(ctx.figures.map((fig) => [fig.label, fig]))
    const firstRef = new Map()
    for (const ref of ctx.refs) {
      if (!ref.key.startsWith('fig:')) continue
      if (!figureMap.has(ref.key)) continue
      const prev = firstRef.get(ref.key)
      if (prev === undefined || ref.line < prev) firstRef.set(ref.key, ref.line)
    }
    for (const [label, refLine] of firstRef) {
      const fig = figureMap.get(label)
      const distance = Math.abs(refLine - fig.line)
      const secDistance = Math.abs(sectionIndexAt(ctx.sections, refLine) - sectionIndexAt(ctx.sections, fig.line))
      let severity = null
      if (distance > 100 || secDistance >= 2) severity = 'major'
      else if (distance > 50 || secDistance === 1) severity = 'minor'
      if (!severity) continue
      findings.push({
        rule: 'figure-ref-distance',
        severity,
        file: ctx.path,
        line: refLine,
        message: '图 ' + label + ' 首次引用（第 ' + refLine + ' 行）与定义（第 ' + fig.line + ' 行）相距 ' + distance + ' 行 / ' + secDistance + ' 个小节。',
        hint: '把首次引用移近图定义，或把图移到引用所在小节。',
      })
    }
    return findings
  },
}

function collectCites(text) {
  const out = []
  CITE_RE.lastIndex = 0
  let match
  while ((match = CITE_RE.exec(text)) !== null) {
    for (const key of splitKeys(match[2])) out.push({ key, line: lineOf(text, match.index), cmd: match[1] })
  }
  return out
}

function collectRefs(text) {
  const out = []
  REF_RE.lastIndex = 0
  let match
  while ((match = REF_RE.exec(text)) !== null) {
    for (const key of splitKeys(match[2])) out.push({ key, line: lineOf(text, match.index), cmd: match[1] })
  }
  return out
}

function collectLabels(text) {
  const hits = new Map()
  LABEL_RE.lastIndex = 0
  let match
  while ((match = LABEL_RE.exec(text)) !== null) {
    const line = lineOf(text, match.index)
    for (const key of splitKeys(match[1])) {
      if (!hits.has(key)) hits.set(key, [])
      hits.get(key).push(line)
    }
  }
  return hits
}

function collectFigures(text) {
  const figures = []
  FIGURE_BEGIN_RE.lastIndex = 0
  let match
  while ((match = FIGURE_BEGIN_RE.exec(text)) !== null) {
    const rest = text.slice(match.index)
    const end = FIGURE_END_RE.exec(rest)
    const body = end ? rest.slice(0, end.index) : rest
    const label = /\\label\{([^}]*)\}/.exec(body)
    if (!label) continue
    const key = splitKeys(label[1])[0]
    if (!key) continue
    figures.push({ label: key, line: lineOf(text, match.index) })
  }
  return figures
}

/**
 * Run chktex over the entry file (external channel, never fatal).
 *
 * Three states, so a caller can tell "switched off" from "not installed":
 *  - 'skipped'     — `config.enableChktex` is not true (optional, default off);
 *  - 'unavailable' — enabled but no usable chktex binary (missing or failed to run);
 *  - 'used'        — chktex ran; warnings (if any) were parsed.
 * @param {{dir:string, entry?:string, timeoutMs:number, enabled:boolean, explicitPath?:string}} opts
 * @returns {{state:'skipped'|'unavailable'|'used', findings:Array, reason?:string}}
 */
function runChktex({ dir, entry, timeoutMs, enabled, explicitPath }) {
  if (enabled !== true) {
    return { state: 'skipped', findings: [], reason: 'config.enableChktex 未开启（可选增强，默认关闭）。' }
  }
  const binary = typeof explicitPath === 'string' && explicitPath.trim() !== ''
    ? resolveTool(explicitPath.trim(), [])
    : resolveTool('miktex-chktex', []) || resolveTool('chktex', [])
  if (!binary) return { state: 'unavailable', findings: [], reason: '未找到 chktex / miktex-chktex。' }
  const target = entry && existsSync(join(dir, entry)) ? entry : listTexFiles(dir).map((p) => p.slice(dir.length + 1))[0]
  if (!target) return { state: 'unavailable', findings: [], reason: '没有可检查的 .tex 文件。' }
  let result
  try {
    result = spawnSync(binary, ['-q', target], {
      cwd: dir,
      encoding: 'utf8',
      timeout: Math.max(5000, Math.min(timeoutMs, 120000)),
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    })
  } catch (error) {
    return { state: 'unavailable', findings: [], reason: 'chktex 启动失败：' + String(error?.message ?? error) }
  }
  if (result.error) return { state: 'unavailable', findings: [], reason: 'chktex 运行失败：' + String(result.error.message ?? result.error) }
  const text = ((result.stdout || '') + '\n' + (result.stderr || '')).replace(/\r\n?/g, '\n')
  const findings = []
  const re = /^(Warning|Error|Message)\s+(\d+)\s+in\s+(.+?)\s+line\s+(\d+):\s*(.*)$/
  for (const line of text.split('\n')) {
    const match = re.exec(line.trim())
    if (!match) continue
    findings.push({
      rule: 'chktex.' + match[2],
      severity: match[1] === 'Error' ? 'major' : 'minor',
      file: match[3].trim(),
      line: Number(match[4]),
      message: match[5].trim(),
      hint: 'chktex 的排版/语法提示，按需修，不要为消警告引入伪修复。',
    })
    if (findings.length >= MAX_FINDINGS) break
  }
  return { state: 'used', findings }
}

/**
 * Lint a LaTeX project.
 * @param {{dir:string, entry?:string, rules?:string[]|null, config?:object}} opts
 * @returns {{findings:Array, protected:object, external:{chktex:'used'|'skipped'|'error'}, advice:Array}}
 */
export function lintProject({ dir, entry, rules = null, config = {} } = {}) {
  const advice = []
  const emptyProtected = { cites: [], labels: [], refs: [], numericTokens: [] }
  const root = typeof dir === 'string' && dir ? resolve(dir) : null
  if (!root || !existsSync(root) || !statSync(root).isDirectory()) {
    return {
      findings: [{ rule: 'project-not-found', severity: 'critical', file: dir ?? '', line: null, message: '项目目录不存在：' + String(dir), hint: '传入工作区内的项目相对路径。' }],
      protected: emptyProtected,
      external: { chktex: 'skipped' },
      advice: [{ level: 'error', message: 'lint 跳过：项目目录不存在。' }],
    }
  }

  const texFiles = listTexFiles(root)
  const entryPath = entry ? join(root, entry) : null
  if (entryPath && existsSync(entryPath) && !texFiles.includes(entryPath)) texFiles.unshift(entryPath)
  // Unreadable sources are skipped instead of aborting the whole lint run: a
  // single locked or directory-shaped `.tex` must not turn the tool into a throw.
  const sources = []
  for (const path of texFiles) {
    try {
      sources.push({ path, text: readFileSync(path, 'utf8').replace(/\r\n?/g, '\n') })
    } catch {
      /* unreadable source: skip it */
    }
  }
  const protectedSet = extractProtected(sources)
  const bibKeys = listBibKeys(root)
  const projectRefs = new Set(protectedSet.refs)

  const enabled = Array.isArray(rules) && rules.length > 0 ? new Set(rules) : null
  const findings = []
  for (const source of sources) {
    const ctx = {
      path: source.path,
      text: source.text,
      cites: collectCites(source.text),
      refs: collectRefs(source.text),
      labelHits: collectLabels(source.text),
      figures: collectFigures(source.text),
      sections: sectionsOf(source.text),
      bibKeys: bibKeys.size > 0 ? bibKeys : null,
      projectRefs,
    }
    ctx.labels = new Set(ctx.labelHits.keys())
    for (const [id, check] of Object.entries(RULES)) {
      if (enabled && !enabled.has(id)) continue
      try {
        findings.push(...check(ctx))
      } catch (error) {
        advice.push({ level: 'warn', message: '规则 ' + id + ' 在 ' + source.path + ' 上失败：' + String(error?.message ?? error) })
      }
    }
  }

  const chktex = runChktex({
    dir: root,
    entry,
    timeoutMs: Number(config?.compileTimeoutMs) || 60000,
    enabled: config?.enableChktex === true,
    explicitPath: config?.chktexPath,
  })
  findings.push(...chktex.findings)
  if (chktex.state === 'skipped') {
    advice.push({ level: 'info', message: chktex.reason ?? 'chktex 未启用。' })
  } else if (chktex.state === 'unavailable') {
    advice.push({ level: 'info', message: chktex.reason ?? '未找到 chktex。', command: 'mpm --install=chktex' })
  }

  const severityRank = { critical: 0, major: 1, minor: 2, info: 3 }
  findings.sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) || (a.file ?? '').localeCompare(b.file ?? '') || (a.line ?? 0) - (b.line ?? 0))

  return {
    findings: findings.slice(0, MAX_FINDINGS),
    protected: protectedSet,
    external: { chktex: chktex.state },
    advice,
  }
}
