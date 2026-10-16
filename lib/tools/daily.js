/**
 * A-line (daily) tool registrations.
 *
 * Tools: latex_doctor / latex_build / latex_lint / bib_tool.
 * This is the only layer allowed to import @deepseek-ai/dsh-tools; all logic
 * lives in the pure-Node lib/core modules.
 * @module dsh-latex-studio/tools/daily
 */

import { existsSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { liveConfig } from '../config.js'
import { resolveWorkspacePath } from '../core/paths.js'
import { probeEnv, _clearResolveCache } from '../core/env.js'
import { build } from '../core/compile.js'
import { lintProject } from '../core/lint.js'
import { bibAction } from '../core/bib.js'

/** Nullable helper for the value-schema DSL. */
const nullable = (schema) => ({ oneOf: [schema, { type: 'null' }] })
const nullableString = nullable({ type: 'string' })
const stringArray = { type: 'array', items: { type: 'string' } }
const objectMap = { type: 'object', additionalProperties: true }
const adviceSchema = { type: 'array', items: { type: 'object', additionalProperties: true } }

/**
 * Resolve the session workspace root the same way the VTO line does: the
 * session header cwd wins, then the `fs` service cwd, then process.cwd().
 * The host process cwd is NOT the workspace in the DSH desktop app, so a bare
 * process.cwd() would misplace every "workspace-relative" path.
 * @param {object} [ctx] - cordis context.
 * @param {{agent?:{session?:{header?:{cwd?:string}}}}} [exec] - tool exec info.
 * @returns {string} absolute workspace root.
 */
export function sessionCwd(ctx, exec) {
  const header = exec && exec.agent && exec.agent.session ? exec.agent.session.header : undefined
  if (header && typeof header.cwd === 'string' && header.cwd !== '') return header.cwd
  const fsService = ctx && typeof ctx.get === 'function' ? ctx.get('fs') : undefined
  if (fsService && typeof fsService.cwd === 'string' && fsService.cwd !== '') return fsService.cwd
  return process.cwd()
}

/**
 * Reject absolute paths and `..` escapes; resolve the rest against the workspace.
 * @param {string} input - workspace-relative path from the model.
 * @param {string} [root] - workspace root (defaults to process.cwd()).
 * @returns {{ok:boolean, abs?:string, rel?:string, message?:string}}
 */
export function workspaceRelativePath(input, root = process.cwd()) {
  const result = resolveWorkspacePath(input, root)
  if (!result.ok) return { ok: false, message: result.message }
  return { ok: true, abs: result.abs, rel: result.rel }
}

/**
 * Keep render-probe output inside the project's workDir so a probe never drops
 * a `pages/` directory into the project root.
 * @param {string} pdfPath - absolute PDF path.
 * @param {object} config - normalized plugin config.
 * @returns {string} absolute output directory.
 */
function renderProbeOutDir(pdfPath, config) {
  const workDirName = typeof config?.workDir === 'string' && config.workDir.trim() !== '' ? config.workDir.trim() : '.latex-studio'
  const dir = dirname(pdfPath)
  const parts = dir.split(/[\\/]+/)
  const index = parts.lastIndexOf(workDirName)
  if (index >= 0) return join(parts.slice(0, index + 1).join(sep), 'pages')
  return join(dir, workDirName, 'pages')
}

function skippedBuild(reason, message) {
  return {
    status: 'skipped',
    engine: null,
    passes: 0,
    durationMs: 0,
    pdfPath: null,
    logPath: null,
    pages: null,
    errors: [],
    warnings: [],
    overfull: [],
    underfull: [],
    missingCitations: [],
    missingRefs: [],
    floatWarnings: [],
    packageWarnings: [],
    logTail: '',
    reason,
    message,
    via: 'builtin',
    stopReason: reason,
    latexmk: null,
    bib: null,
    advice: [{ level: 'error', message }],
  }
}

/** Force a stable, schema-complete build result. */
function shapeBuild(result, message = null) {
  return {
    status: result?.status ?? 'failed',
    engine: result?.engine ?? null,
    passes: Number(result?.passes ?? 0),
    durationMs: Number(result?.durationMs ?? 0),
    pdfPath: result?.pdfPath ?? null,
    logPath: result?.logPath ?? null,
    pages: result?.pages ?? null,
    errors: Array.isArray(result?.errors) ? result.errors : [],
    warnings: Array.isArray(result?.warnings) ? result.warnings : [],
    overfull: Array.isArray(result?.overfull) ? result.overfull : [],
    underfull: Array.isArray(result?.underfull) ? result.underfull : [],
    missingCitations: Array.isArray(result?.missingCitations) ? result.missingCitations : [],
    missingRefs: Array.isArray(result?.missingRefs) ? result.missingRefs : [],
    floatWarnings: Array.isArray(result?.floatWarnings) ? result.floatWarnings : [],
    packageWarnings: Array.isArray(result?.packageWarnings) ? result.packageWarnings : [],
    logTail: typeof result?.logTail === 'string' ? result.logTail : '',
    reason: result?.reason ?? null,
    via: result?.via ?? 'builtin',
    stopReason: result?.stopReason ?? null,
    latexmk: result?.latexmk ?? null,
    message,
    bib: result?.bib ?? null,
    advice: Array.isArray(result?.advice) ? result.advice : [],
  }
}

function buildReportLine(value) {
  const head = '[' + value.status + '] via=' + (value.via ?? 'builtin') + ' engine=' + (value.engine ?? '-') + ' passes=' + value.passes + ' pages=' + (value.pages ?? '?') + ' ' + value.durationMs + 'ms'
    + (value.stopReason ? ' stop=' + value.stopReason : '')
  const lines = [head]
  if (value.pdfPath) lines.push('PDF: ' + value.pdfPath)
  if (value.bib?.tool) lines.push('bib: ' + value.bib.tool + (value.bib.ran ? ' (exit ' + String(value.bib.exitCode ?? '?') + ')' : ' (not run)'))
  if (value.errors.length > 0) {
    lines.push('errors (' + value.errors.length + '):')
    for (const error of value.errors.slice(0, 5)) lines.push('  - ' + (error.file ?? '?') + ':' + (error.line ?? '?') + ' ' + error.message)
  }
  const counts = []
  if (value.overfull.length) counts.push('overfull ' + value.overfull.length)
  if (value.underfull.length) counts.push('underfull ' + value.underfull.length)
  if (value.missingRefs.length) counts.push('undefined refs ' + value.missingRefs.length)
  if (value.missingCitations.length) counts.push('undefined cites ' + value.missingCitations.length)
  if (counts.length) lines.push('warnings: ' + counts.join(', '))
  for (const item of value.advice) lines.push('[' + item.level + '] ' + item.message)
  if (value.status !== 'passed' && value.logTail) {
    lines.push('--- log tail ---')
    lines.push(value.logTail.split('\n').slice(-12).join('\n'))
  }
  return lines.join('\n')
}

function lintReportLine(value) {
  const lines = ['lint: ' + value.findings.length + ' findings, chktex=' + value.external.chktex]
  for (const finding of value.findings.slice(0, 12)) {
    lines.push('  [' + finding.severity + '] ' + finding.rule + ' ' + (finding.file ?? '?') + ':' + (finding.line ?? '?') + ' ' + finding.message)
  }
  if (value.findings.length > 12) lines.push('  ... ' + (value.findings.length - 12) + ' more')
  lines.push('protected: cites=' + value.protected.cites.length + ' labels=' + value.protected.labels.length + ' refs=' + value.protected.refs.length + ' numericTokens=' + value.protected.numericTokens.length)
  for (const item of value.advice ?? []) lines.push('[' + item.level + '] ' + item.message)
  return lines.join('\n')
}

function bibReportLine(value) {
  const lines = ['bib ' + value.action + ': ok=' + value.ok + ' issues=' + value.issues.length + (value.written ? ' written=true' : '')]
  for (const item of value.issues.slice(0, 10)) lines.push('  [' + item.severity + '] ' + item.code + ' ' + item.message)
  if (value.missingInBib?.length) lines.push('missinInBib: ' + value.missingInBib.join(', '))
  if (value.uncited?.length) lines.push('uncited: ' + value.uncited.join(', '))
  if (value.error) lines.push('error: ' + value.error.code + ' ' + value.error.message)
  if (value.fixed) lines.push('--- preview ---\n' + value.fixed.split('\n').slice(0, 30).join('\n'))
  for (const item of value.advice ?? []) lines.push('[' + item.level + '] ' + item.message)
  return lines.join('\n')
}

/** latex_doctor */
function doctorTool(config, resolveRoot) {
  return defineTool({
    name: 'latex_doctor',
    description: '探测本机 LaTeX 工具链（MiKTeX 引擎/biber/bibtex/chktex、Poppler、MiKTeX Ghostscript、Python）并给出缺失项与安装建议。写/编译前先跑一次。',
    parameters: {
      refresh: { type: 'boolean', description: 'true 时先清空可执行文件解析缓存再探测（默认复用缓存）。' },
      verifyPdfRead: { type: 'boolean', description: 'true 时真渲染指定 PDF 的第 1 页，验证本地页图通道（默认 false，只报存在性）。' },
      pdfPath: { type: 'string', description: 'verifyPdfRead 用的 PDF 路径（工作区相对路径，例如 .latex-studio/build/main.pdf）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          status: { type: 'string', required: true },
          latex: { ...objectMap, required: true },
          poppler: { ...objectMap, required: true },
          ghostscript: { ...objectMap, required: true },
          mineru: { ...objectMap, required: true },
          python: { ...objectMap, required: true },
          node: { ...objectMap, required: true },
          config: { ...objectMap, required: true },
          renderProbe: {
            type: 'object',
            additionalProperties: true,
            required: true,
            properties: {
              status: { type: 'string', required: true },
              backend: { ...nullableString, required: true },
              bytes: { ...nullable({ type: 'integer' }), required: true },
              reason: { ...nullableString, required: true },
              path: { ...nullableString, required: true },
            },
          },
          advice: { ...adviceSchema, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          'latex=' + (value.latex.command ?? 'none') + ' (' + (value.latex.version ?? '?') + ')',
          'isMiKTeX=' + value.latex.isMiKTeX + ' bin=' + (value.latex.binDir ?? '-'),
          'biber=' + (value.latex.biber ?? '-') + ' bibtex=' + (value.latex.bibtex ?? '-') + ' chktex=' + (value.latex.chktex ?? '-'),
          'pdftoppm=' + (value.poppler.pdftoppm ?? '-') + ' mgs=' + (value.ghostscript.mgs ?? '-'),
          'read_pdf=' + value.mineru.toolName + ' provider=' + (value.mineru.activeProvider ?? '-') + ' uploads=' + value.mineru.uploadsData,
          'node=' + value.node.version + ' python=' + (value.python.path ?? '-'),
          'renderProbe=[' + value.renderProbe.status + '] backend=' + (value.renderProbe.backend ?? '-') + ' bytes=' + (value.renderProbe.bytes ?? '-') + (value.renderProbe.reason ? ' (' + value.renderProbe.reason + ')' : ''),
          ...value.advice.map((item) => '[' + item.level + '] ' + item.message + (item.command ? '  -> ' + item.command : '')),
        ].join('\n'),
      }],
    },
    timeoutMs: 45000,
    execute: async (args, exec) => {
      const root = resolveRoot(exec)
      if (args.refresh === true) _clearResolveCache()
      const report = await probeEnv(config)
      let renderProbe = { status: 'skipped', backend: null, bytes: null, reason: 'verifyPdfRead=false：只报存在性，未做页图渲染。', path: null }
      if (args.verifyPdfRead === true) {
        if (typeof args.pdfPath !== 'string' || args.pdfPath.trim() === '') {
          renderProbe = { status: 'skipped', backend: null, bytes: null, reason: 'verifyPdfRead=true 但未提供 pdfPath。', path: null }
        } else {
          const resolved = workspaceRelativePath(args.pdfPath, root)
          if (!resolved.ok) {
            renderProbe = { status: 'skipped', backend: null, bytes: null, reason: resolved.message, path: null }
          } else {
            try {
              const { renderPages } = await import('../core/render.js')
              const rendered = await renderPages({ pdfPath: resolved.abs, pages: 1, dpi: 120, outDir: renderProbeOutDir(resolved.abs, config), config })
              const first = Array.isArray(rendered?.pages) ? rendered.pages[0] : null
              renderProbe = {
                status: rendered?.status ?? 'failed',
                backend: rendered?.backend ?? null,
                bytes: first?.bytes ?? null,
                reason: rendered?.reason ?? null,
                path: first?.path ?? null,
              }
            } catch (error) {
              renderProbe = { status: 'failed', backend: null, bytes: null, reason: 'render.js 不可用：' + String(error?.message ?? error), path: null }
            }
          }
        }
      }
      return { status: report.latex.command ? 'ok' : 'degraded', ...report, renderProbe }
    },
    presentCall: () => ({ card: 'generic', kind: 'read', title: 'LaTeX 环境体检' }),
  })
}

/** latex_build */
function buildTool(config, resolveRoot) {
  return defineTool({
    name: 'latex_build',
    description: '编译 LaTeX 项目：可用时优先 latexmk（.fls 依赖追踪 + 正确重跑），否则用内置多趟驱动（引擎 → 需要时 bibtex/biber/makeindex → 再跑至 .aux 稳定，最多 4 趟）。返回 status/via/stopReason/passes、PDF 路径、页数、结构化 errors（含 file:line）、overfull/underfull 与日志尾部。',
    parameters: {
      dir: { type: 'string', required: true, description: '项目目录（工作区相对路径，例如 latex-demo）。' },
      entry: { type: 'string', description: '入口 .tex（相对 dir，默认 main.tex）。' },
      engine: { type: 'string', enum: ['auto', 'pdflatex', 'xelatex', 'lualatex'], description: '默认 auto：按源码自动判定。' },
      clean: { type: 'boolean', description: '编译前清空 build/ 与 auxfiles/（默认 false）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          status: { type: 'string', required: true },
          engine: { ...nullableString, required: true },
          passes: { type: 'integer', required: true },
          durationMs: { type: 'integer', required: true },
          pdfPath: { ...nullableString, required: true },
          logPath: { ...nullableString, required: true },
          pages: { ...nullable({ type: 'integer' }), required: true },
          errors: { type: 'array', required: true, items: objectMap },
          warnings: { type: 'array', required: true, items: objectMap },
          overfull: { type: 'array', required: true, items: objectMap },
          underfull: { type: 'array', required: true, items: objectMap },
          missingCitations: { ...stringArray, required: true },
          missingRefs: { ...stringArray, required: true },
          floatWarnings: { type: 'array', required: true, items: objectMap },
          packageWarnings: { type: 'array', required: true, items: objectMap },
          logTail: { type: 'string', required: true },
          reason: { ...nullableString, required: true },
          via: { ...nullableString, required: true },
          stopReason: { ...nullableString, required: true },
          latexmk: { ...nullable(objectMap), required: true },
          message: { ...nullableString, required: true },
          bib: { ...nullable(objectMap), required: true },
          advice: { ...adviceSchema, required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: buildReportLine(value) }],
    },
    timeoutMs: Math.max(60000, Number(config.compileTimeoutMs) || 300000) + 30000,
    execute: async (args, exec) => {
      const dir = workspaceRelativePath(args.dir, resolveRoot(exec))
      if (!dir.ok) return skippedBuild('INVALID_PATH', dir.message)
      if (!existsSync(dir.abs) || !statSync(dir.abs).isDirectory()) {
        return skippedBuild('PROJECT_DIR_NOT_FOUND', '项目目录不存在（工作区内）：' + args.dir)
      }
      const result = await build({
        dir: dir.abs,
        entry: args.entry,
        engine: args.engine ?? 'auto',
        clean: args.clean === true,
        config,
      })
      return shapeBuild(result)
    },
    presentCall: (args) => ({ card: 'generic', kind: 'run', title: '编译 LaTeX', rawInput: args.dir }),
  })
}

/** latex_lint */
function lintTool(config, resolveRoot) {
  return defineTool({
    name: 'latex_lint',
    description: '静态检查 LaTeX 项目：禁用伪修复（\\resizebox / 裸 \\vspace / \\tiny / \\newpage 滥用）、引用与标签对账、图-引用距离，并附 MiKTeX chktex 外部提示。返回受保护清单（引用键/标签/数字 token）。',
    parameters: {
      dir: { type: 'string', required: true, description: '项目目录（工作区相对路径）。' },
      entry: { type: 'string', description: '入口 .tex（相对 dir，默认 main.tex）。' },
      rules: { type: 'array', items: { type: 'string' }, description: '只跑指定规则 id；省略则全部。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          status: { type: 'string', required: true },
          findings: { type: 'array', required: true, items: objectMap },
          protected: { ...objectMap, required: true },
          external: { ...objectMap, required: true },
          advice: { ...adviceSchema, required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: lintReportLine(value) }],
    },
    timeoutMs: 120000,
    execute: async (args, exec) => {
      const dir = workspaceRelativePath(args.dir, resolveRoot(exec))
      if (!dir.ok) {
        return { status: 'skipped', findings: [], protected: { cites: [], labels: [], refs: [], numericTokens: [] }, external: { chktex: 'skipped' }, advice: [{ level: 'error', message: dir.message }] }
      }
      const report = lintProject({ dir: dir.abs, entry: args.entry, rules: args.rules ?? null, config })
      const hasCritical = report.findings.some((finding) => finding.severity === 'critical' || finding.severity === 'major')
      return { status: hasCritical ? 'issues' : 'clean', ...report }
    },
    presentCall: (args) => ({ card: 'generic', kind: 'read', title: 'Lint LaTeX', rawInput: args.dir }),
  })
}

/** bib_tool */
function bibTool(config, resolveRoot) {
  return defineTool({
    name: 'bib_tool',
    description: '参考文献工具：lint（结构+字段+biber --tool 外部校验）/ format（规范化，可选写入）/ fill（Crossref 只补不覆盖）/ audit（\\cite 与 .bib 双向对账）。写入前强制校验结构完整，不完整直接拒绝并回滚。',
    parameters: {
      action: { type: 'string', required: true, enum: ['lint', 'format', 'fill', 'audit'], description: '要执行的动作。' },
      bib: { type: 'string', required: true, description: '.bib 路径（工作区相对路径）。' },
      tex: { ...stringArray, description: 'audit 用的 .tex 文件（工作区相对路径）。' },
      write: { type: 'boolean', description: 'format/fill 时是否真正写回（默认 false，仅预览）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          status: { type: 'string', required: true },
          ok: { type: 'boolean', required: true },
          action: { type: 'string', required: true },
          issues: { type: 'array', required: true, items: objectMap },
          fixed: { ...nullableString, required: true },
          written: { type: 'boolean', required: true },
          missingInBib: { ...stringArray, required: true },
          uncited: { ...stringArray, required: true },
          error: { ...nullable(objectMap), required: true },
          external: { ...objectMap, required: true },
          backupPath: { ...nullableString, required: true },
          advice: { ...adviceSchema, required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: bibReportLine(value) }],
    },
    timeoutMs: 120000,
    execute: async (args, exec) => {
      const root = resolveRoot(exec)
      const bib = workspaceRelativePath(args.bib, root)
      if (!bib.ok) {
        return {
          status: 'skipped', ok: false, action: args.action, issues: [], fixed: null, written: false,
          missingInBib: [], uncited: [], error: { code: 'INVALID_PATH', message: bib.message },
          external: {}, backupPath: null, advice: [{ level: 'error', message: bib.message }],
        }
      }
      const texPaths = []
      for (const item of Array.isArray(args.tex) ? args.tex : []) {
        const resolved = workspaceRelativePath(item, root)
        if (!resolved.ok) {
          return {
            status: 'skipped', ok: false, action: args.action, issues: [], fixed: null, written: false,
            missingInBib: [], uncited: [], error: { code: 'INVALID_PATH', message: resolved.message },
            external: {}, backupPath: null, advice: [{ level: 'error', message: resolved.message }],
          }
        }
        texPaths.push(resolved.abs)
      }
      const result = await bibAction({
        action: args.action,
        bibPath: bib.abs,
        texFiles: texPaths,
        write: args.write === true,
        config,
      })
      const relative = (path) => (typeof path === 'string' && path.toLowerCase().startsWith(root.toLowerCase()) ? path.slice(root.length + 1) : path ?? null)
      return {
        status: result.ok ? 'ok' : 'failed',
        ok: result.ok === true,
        action: result.action,
        issues: Array.isArray(result.issues) ? result.issues : [],
        fixed: result.fixed ?? null,
        written: result.written === true,
        missingInBib: Array.isArray(result.missingInBib) ? result.missingInBib : [],
        uncited: Array.isArray(result.uncited) ? result.uncited : [],
        error: result.error ?? null,
        external: result.external ?? {},
        backupPath: relative(result.backupPath) ?? null,
        advice: Array.isArray(result.advice) ? result.advice : [],
      }
    },
    presentCall: (args) => ({ card: 'generic', kind: 'read', title: 'BibTeX 工具', rawInput: args.bib }),
  })
}

/**
 * Register the A-line tools on a cordis context.
 * @param {{tools:{register:Function}, logger?:object}} ctx - cordis context.
 * @param {Record<string, unknown>} [entryConfig] - raw patch config.
 * @returns {Array<Function>} disposers for the registered tools.
 */
export function registerDaily(ctx, entryConfig = {}) {
  const config = liveConfig(ctx, entryConfig)
  const disposers = []
  const resolveRoot = (exec) => sessionCwd(ctx, exec)
  const factories = [doctorTool, buildTool, lintTool, bibTool]
  for (const factory of factories) {
    try {
      disposers.push(ctx.tools.register(factory(config, resolveRoot)))
    } catch (error) {
      const logger = ctx?.logger ?? ctx?.console
      if (typeof logger?.warn === 'function') {
        logger.warn('[dsh-latex-studio] tool registration failed: ' + String(error?.message ?? error))
      }
    }
  }
  return disposers
}
