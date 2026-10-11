/**
 * Local page-image rendering (INTERFACES.md 8) with four safeguards.
 *
 * Backends, tried in `config.rendererOrder` order:
 *  1. `poppler`            — `pdftoppm` (`-png -r <dpi> -f N -l N -singlefile`).
 *                            MiKTeX 25.12 ships Poppler 24.04 inside
 *                            `D:\MiKTeX\miktex\bin\x64`; the DSH process PATH
 *                            usually does NOT contain it, so an absolute path
 *                            plus a `--` separator is mandatory on Windows.
 *  2. `miktex-ghostscript` — MiKTeX's own GPL Ghostscript 9.25 (`mgs.exe`),
 *                            zero extra install, verified on this machine.
 *  3. `mineru-page`        — the injected `callReadPdf` bridge
 *                            (`read_pdf({view:'page'})`); local-only, never uploads.
 *  4. Explicit reason + install advice; the caller downgrades to checklist-only.
 *
 * Every failure path returns a structured result — this module never throws.
 * Pure Node ESM (node:child_process only) — no DSH imports.
 * @module dsh-latex-studio/core/render
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { normalizeConfig } from '../config.js'

/** Backend ids accepted in `config.rendererOrder`. */
export const BACKENDS = Object.freeze(['poppler', 'miktex-ghostscript', 'mineru-page'])

/** MiKTeX bin directories searched when PATH does not carry them. */
export const MIKTEX_BIN_DIRS = Object.freeze([
  'D:\\MiKTeX\\miktex\\bin\\x64',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'),
  'C:\\Program Files\\MiKTeX\\miktex\\bin\\x64',
])

/** Install / repair advice per backend. */
export const INSTALL_ADVICE = Object.freeze({
  poppler:
    'Poppler 随 MiKTeX 提供（D:\\MiKTeX\\miktex\\bin\\x64\\pdftoppm.exe）。若探测不到：把该目录加入 PATH，或设置 config.popplerPath 指向 pdftoppm.exe；也可 scoop install poppler / winget install oschwartz10612.Poppler。',
  'miktex-ghostscript':
    'mgs.exe 随 MiKTeX 安装于 D:\\MiKTeX\\miktex\\bin\\x64；缺失时用 MiKTeX Console 或 mpm --install=ghostscript 补装。',
  'mineru-page':
    'read_pdf 的 page 视图不可用（本机实测 PDF.js returned invalid page metadata）。请优先使用本地后端 poppler / miktex-ghostscript。',
})

/** Captured-output cap for one child process. */
const MAX_BUFFER = 8 * 1024 * 1024

/** Executable suffixes probed when a bare name is given. */
function extensionCandidates(pathext) {
  const exts = ['']
  for (const part of String(pathext || '.EXE;.CMD;.BAT;.COM').split(';')) {
    const ext = part.trim()
    if (!ext) continue
    exts.push(ext, ext.toLowerCase(), ext.toUpperCase())
  }
  return [...new Set(exts)]
}

/** First existing file among candidates (optionally suffixed). */
function firstExisting(candidates, exts) {
  for (const candidate of candidates) {
    if (!candidate) continue
    for (const ext of exts) {
      const probe = ext ? candidate + ext : candidate
      try {
        if (fs.statSync(probe).isFile()) return probe
      } catch {
        /* keep probing */
      }
    }
  }
  return null
}

/**
 * Locate an executable.
 * Search order: explicit path/dir → PATH → extra dirs (MiKTeX bin by default).
 * @param {string} name - executable base name, e.g. `pdftoppm`.
 * @param {object} [options] - search overrides.
 * @param {string} [options.explicit] - config-provided file or directory.
 * @param {string[]} [options.extraDirs] - additional directories (default MiKTeX bin dirs).
 * @param {string} [options.pathEnv] - PATH override (tests).
 * @param {string} [options.pathext] - PATHEXT override (tests).
 * @returns {string|null} absolute executable path, or null.
 */
export function resolveExecutable(name, options = {}) {
  const exts = extensionCandidates(options.pathext ?? process.env.PATHEXT)
  const candidates = []

  const explicit = options.explicit
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    const value = explicit.trim()
    try {
      if (fs.statSync(value).isDirectory()) candidates.push(path.join(value, name))
      else candidates.push(value)
    } catch {
      candidates.push(value)
    }
  }

  const pathEnv = options.pathEnv !== undefined ? options.pathEnv : process.env.PATH
  for (const dir of String(pathEnv || '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, name))
  }

  const extraDirs = options.extraDirs !== undefined ? options.extraDirs : MIKTEX_BIN_DIRS
  for (const dir of extraDirs || []) {
    if (dir) candidates.push(path.join(dir, name))
  }

  return firstExisting(candidates, exts)
}

/**
 * Run one child process, capturing output. Never rejects.
 * @param {string} command - absolute executable.
 * @param {string[]} args - argument array (never a shell string).
 * @param {{cwd?: string, timeoutMs?: number, signal?: AbortSignal}} [options] - run options.
 * @returns {Promise<{code: number, stdout: string, stderr: string, error: string|null, timedOut: boolean}>}
 */
export function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    let settled = false
    const done = (value) => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    try {
      const child = execFile(
        command,
        args,
        {
          cwd: options.cwd,
          timeout: options.timeoutMs ?? 60000,
          windowsHide: true,
          maxBuffer: MAX_BUFFER,
          encoding: 'utf8',
          signal: options.signal,
        },
        (error, stdout, stderr) => {
          const timedOut = Boolean(error && (error.killed === true || error.signal === 'SIGTERM'))
          done({
            code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            error: error ? String(error.message) : null,
            timedOut,
          })
        }
      )
      child.on('error', (error) => {
        done({ code: 1, stdout: '', stderr: '', error: String(error && error.message), timedOut: false })
      })
    } catch (error) {
      done({ code: 1, stdout: '', stderr: '', error: String((error && error.message) || error), timedOut: false })
    }
  })
}

/**
 * Page count from `pdfinfo`, falling back to a `/Count` scan of the raw bytes.
 * @param {string} pdfPath - PDF path.
 * @param {object} [options] - search options plus `pdfinfoPath`, `pathEnv`, `extraDirs`, `timeoutMs`.
 * @returns {Promise<{pages: number|null, source: 'pdfinfo'|'raw'|null, error: string|null}>}
 */
export async function countPdfPages(pdfPath, options = {}) {
  let lastError = null
  const pdfinfo = resolveExecutable('pdfinfo', options)
  if (pdfinfo) {
    const result = await runCommand(pdfinfo, ['--', path.resolve(pdfPath)], { timeoutMs: options.timeoutMs ?? 30000 })
    if (result.code === 0) {
      const match = /^Pages:\s+(\d+)/m.exec(result.stdout)
      if (match) return { pages: Number(match[1]), source: 'pdfinfo', error: null }
    } else {
      lastError = result.error || result.stderr || ('pdfinfo exit ' + result.code)
    }
  }

  try {
    const raw = fs.readFileSync(pdfPath).toString('latin1')
    const counts = [...raw.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]))
    if (counts.length > 0) return { pages: Math.max(...counts), source: 'raw', error: null }
  } catch (error) {
    lastError = lastError || String((error && error.message) || error)
  }

  return { pages: null, source: null, error: lastError }
}

/**
 * Parse a page selector.
 * @param {'all'|number|string|number[]} spec - `'all'`, `3`, `'1-3,5'` or `[1,2]`.
 * @param {number|null} total - total page count when known.
 * @returns {number[]} 1-based page numbers, ascending, deduplicated.
 */
export function parsePages(spec, total) {
  const limit = Number.isFinite(Number(total)) && Number(total) > 0 ? Number(total) : null
  const clamp = (n) => (Number.isFinite(n) && n >= 1 && (limit === null || n <= limit) ? Math.floor(n) : null)
  const out = new Set()

  const addRange = (from, to) => {
    const start = clamp(from)
    const end = clamp(to)
    if (start === null || end === null) return
    for (let i = Math.min(start, end); i <= Math.max(start, end); i++) out.add(i)
  }

  if (spec === undefined || spec === null || spec === 'all') {
    if (limit === null) return []
    for (let i = 1; i <= limit; i++) out.add(i)
    return [...out]
  }
  const parts = Array.isArray(spec) ? spec : String(spec).split(',')
  for (const part of parts) {
    if (typeof part === 'number') {
      const single = clamp(part)
      if (single !== null) out.add(single)
      continue
    }
    const text = String(part).trim()
    if (text === '') continue
    const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(text)
    if (range) {
      addRange(Number(range[1]), Number(range[2]))
      continue
    }
    const single = clamp(Number(text))
    if (single !== null) out.add(single)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * PNG pixel dimensions from the IHDR chunk (no image library needed).
 * @param {string} file - PNG path.
 * @returns {{width: number|null, height: number|null}}
 */
export function readPngSize(file) {
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const head = Buffer.alloc(24)
      const read = fs.readSync(fd, head, 0, 24, 0)
      if (read < 24) return { width: null, height: null }
      if (head.toString('latin1', 1, 4) !== 'PNG') return { width: null, height: null }
      return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return { width: null, height: null }
  }
}

/** Newest `*.png` produced under a prefix, tolerating `-N.png` naming. */
function findProducedPng(prefix, page) {
  const candidates = [prefix + '.png', prefix + '-' + page + '.png']
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      /* try next */
    }
  }
  try {
    const dir = path.dirname(prefix)
    const base = path.basename(prefix)
    const found = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(base) && f.toLowerCase().endsWith('.png'))
      .sort()
    if (found.length > 0) return path.join(dir, found[found.length - 1])
  } catch {
    /* directory may not exist yet */
  }
  return null
}

/** `pdftoppm` one page. Tries the Windows-safe `--` form first, then the plain form. */
async function renderPageWithPoppler({ exe, pdfPath, page, dpi, outPrefix, timeoutMs, signal }) {
  const base = ['-png', '-r', String(dpi), '-f', String(page), '-l', String(page), '-singlefile']
  const attempts = [
    [...base, '--', pdfPath, outPrefix],
    [...base, pdfPath, outPrefix],
  ]
  let last = null
  for (const args of attempts) {
    const result = await runCommand(exe, args, { timeoutMs, signal })
    const produced = findProducedPng(outPrefix, page)
    if (result.code === 0 && produced) return { ok: true, path: produced }
    last = result
  }
  return { ok: false, error: (last && (last.error || last.stderr || last.stdout)) || 'pdftoppm 未产出 PNG', code: last ? last.code : null }
}

/** `mgs.exe` (Ghostscript) one page. */
async function renderPageWithGhostscript({ exe, pdfPath, page, dpi, outFile, timeoutMs, signal }) {
  const args = [
    '-dNOPAUSE',
    '-dBATCH',
    '-sDEVICE=png16m',
    '-r' + dpi,
    '-dFirstPage=' + page,
    '-dLastPage=' + page,
    '-sOutputFile=' + outFile,
    pdfPath,
  ]
  const result = await runCommand(exe, args, { timeoutMs, signal })
  let exists = false
  try {
    exists = fs.statSync(outFile).isFile() && fs.statSync(outFile).size > 0
  } catch {
    exists = false
  }
  if (result.code === 0 && exists) return { ok: true, path: outFile }
  return { ok: false, error: result.error || result.stderr || result.stdout || 'mgs 未产出 PNG', code: result.code }
}

/** Build one page record from a produced file. */
function pageRecord(index, file) {
  let bytes = null
  try {
    bytes = fs.statSync(file).size
  } catch {
    bytes = null
  }
  const size = readPngSize(file)
  return { index, path: file, width: size.width, height: size.height, bytes }
}

/**
 * Render PDF pages to PNG.
 * @param {object} opts - render request.
 * @param {string} opts.pdfPath - PDF to render.
 * @param {'all'|number|string|number[]} [opts.pages='all'] - page selector.
 * @param {number} [opts.dpi=150] - resolution.
 * @param {string} [opts.outDir] - output directory (default `<pdf dir>/pages`).
 * @param {object} [opts.config] - plugin config (`rendererOrder`, `popplerPath`, ...).
 * @param {Function} [opts.callReadPdf] - tools-layer bridge for `read_pdf({view:'page'})`.
 * @param {AbortSignal} [opts.signal] - cancellation.
 * @param {string} [opts.pathEnv] - PATH override (tests).
 * @param {string[]} [opts.extraDirs] - extra tool dirs (tests).
 * @param {number} [opts.timeoutMs] - per-command timeout.
 * @returns {Promise<{status: 'ok'|'skipped'|'failed', backend: string|null, pages: Array<{index: number, path: string|null, width: number|null, height: number|null, bytes: number|null, attachment?: unknown}>, reason?: string, advice?: string, attempts?: object[], rendererDowngrade?: boolean}>}
 */
export async function renderPages(opts = {}) {
  const config = normalizeConfig(opts.config)
  const dpi = Number.isFinite(Number(opts.dpi)) && Number(opts.dpi) > 0 ? Math.floor(Number(opts.dpi)) : 150
  const timeoutMs = Number.isFinite(Number(opts.timeoutMs ?? config.renderTimeoutMs))
    ? Number(opts.timeoutMs ?? config.renderTimeoutMs)
    : 60000
  const signal = opts.signal
  const attempts = []

  const pdfPath = typeof opts.pdfPath === 'string' && opts.pdfPath.trim() !== '' ? path.resolve(opts.pdfPath) : null
  if (!pdfPath) {
    return { status: 'skipped', backend: null, pages: [], reason: 'renderPages 需要 pdfPath', advice: '先运行 latex_build 生成 PDF，再调用 vto_inspect。', attempts }
  }
  let pdfStat = null
  try {
    pdfStat = fs.statSync(pdfPath)
  } catch {
    pdfStat = null
  }
  if (!pdfStat || !pdfStat.isFile()) {
    return { status: 'skipped', backend: null, pages: [], reason: 'PDF 不存在：' + pdfPath, advice: '先编译出 PDF（latex_build），或核对路径是否正确。', attempts }
  }
  if (pdfStat.size === 0) {
    return { status: 'skipped', backend: null, pages: [], reason: 'PDF 为空文件：' + pdfPath, advice: '重新编译；空 PDF 通常意味着编译在写出阶段失败。', attempts }
  }

  const outDir = path.resolve(opts.outDir ?? path.join(path.dirname(pdfPath), 'pages'))
  try {
    fs.mkdirSync(outDir, { recursive: true })
  } catch (error) {
    return { status: 'failed', backend: null, pages: [], reason: '无法创建输出目录：' + String((error && error.message) || error), attempts }
  }

  const searchOptions = { pathEnv: opts.pathEnv, extraDirs: opts.extraDirs, pathext: opts.pathext }
  const totalInfo = await countPdfPages(pdfPath, { ...searchOptions, timeoutMs })
  const total = totalInfo.pages
  const wanted = parsePages(opts.pages ?? 'all', total)
  if (wanted.length === 0 && (opts.pages === undefined || opts.pages === null || opts.pages === 'all') && total === null) {
    // Unknown page count: probe upward until pdftoppm/gs stops producing pages.
    for (let i = 1; i <= 60; i++) wanted.push(i)
  }
  if (wanted.length === 0) {
    return { status: 'skipped', backend: null, pages: [], reason: '无法解析页码范围：' + JSON.stringify(opts.pages ?? 'all'), attempts }
  }

  const order = Array.isArray(config.rendererOrder) ? config.rendererOrder : ['poppler', 'miktex-ghostscript', 'mineru-page']

  for (const backend of order) {
    if (signal && signal.aborted) return { status: 'failed', backend: null, pages: [], reason: '已取消', attempts }

    if (backend === 'poppler') {
      const exe = resolveExecutable('pdftoppm', { ...searchOptions, explicit: config.popplerPath })
      if (!exe) {
        attempts.push({ backend, available: false, reason: '未找到 pdftoppm', advice: INSTALL_ADVICE.poppler })
        continue
      }
      const pages = []
      let failure = null
      for (const page of wanted) {
        const prefix = path.join(outDir, 'page-' + String(page).padStart(3, '0'))
        const result = await renderPageWithPoppler({ exe, pdfPath, page, dpi, outPrefix: prefix, timeoutMs, signal })
        if (!result.ok) {
          // An unknown page count means "stop at the first missing page".
          if (total === null && failure === null) break
          failure = failure || result.error
          continue
        }
        pages.push(pageRecord(page, result.path))
      }
      attempts.push({ backend, available: true, exe, produced: pages.length, requested: wanted.length, error: failure })
      if (pages.length > 0 && (total === null || pages.length === wanted.length)) {
        return { status: 'ok', backend: 'poppler', pages, attempts, pageCount: total, pageCountSource: totalInfo.source }
      }
      if (pages.length > 0) {
        return { status: 'failed', backend: 'poppler', pages, attempts, reason: '仅渲染 ' + pages.length + '/' + wanted.length + ' 页；' + (failure || ''), advice: '检查 PDF 是否完整、页码是否越界。' }
      }
      continue
    }

    if (backend === 'miktex-ghostscript') {
      const exe = resolveExecutable('mgs', { ...searchOptions, explicit: config.ghostscriptPath })
      if (!exe) {
        attempts.push({ backend, available: false, reason: '未找到 mgs.exe', advice: INSTALL_ADVICE['miktex-ghostscript'] })
        continue
      }
      const pages = []
      let failure = null
      for (const page of wanted) {
        const outFile = path.join(outDir, 'page-' + String(page).padStart(3, '0') + '.png')
        const result = await renderPageWithGhostscript({ exe, pdfPath, page, dpi, outFile, timeoutMs, signal })
        if (!result.ok) {
          if (total === null && failure === null) break
          failure = failure || result.error
          continue
        }
        pages.push(pageRecord(page, result.path))
      }
      attempts.push({ backend, available: true, exe, produced: pages.length, requested: wanted.length, error: failure })
      if (pages.length > 0 && (total === null || pages.length === wanted.length)) {
        return { status: 'ok', backend: 'miktex-ghostscript', pages, attempts, pageCount: total, pageCountSource: totalInfo.source }
      }
      if (pages.length > 0) {
        return { status: 'failed', backend: 'miktex-ghostscript', pages, attempts, reason: '仅渲染 ' + pages.length + '/' + wanted.length + ' 页；' + (failure || ''), advice: '检查 PDF 是否完整、页码是否越界。' }
      }
      continue
    }

    if (backend === 'mineru-page') {
      if (typeof opts.callReadPdf !== 'function') {
        attempts.push({ backend, available: false, reason: '未注入 callReadPdf（tools 层桥）', advice: INSTALL_ADVICE['mineru-page'] })
        continue
      }
      const pages = []
      let failure = null
      for (const page of wanted) {
        let value = null
        try {
          value = await opts.callReadPdf({ pdfPath, page, outDir, dpi, signal })
        } catch (error) {
          failure = failure || String((error && error.message) || error)
          continue
        }
        if (!value) {
          failure = failure || 'callReadPdf 未返回图像'
          continue
        }
        if (value.attachment) {
          pages.push({ index: page, path: value.path ?? null, width: value.width ?? null, height: value.height ?? null, bytes: value.bytes ?? null, attachment: value.attachment })
          continue
        }
        if (typeof value.path === 'string' && fs.existsSync(value.path)) {
          pages.push({ ...pageRecord(page, value.path), ...(value.width ? { width: value.width } : {}), ...(value.height ? { height: value.height } : {}) })
          continue
        }
        // raw bytes bridge: { data, mediaType } — persist so callers can read it back
        if (value.data) {
          const file = path.join(outDir, 'page-' + String(page).padStart(3, '0') + '.png')
          try {
            fs.writeFileSync(file, Buffer.from(value.data, value.encoding === 'base64' ? 'base64' : undefined))
            pages.push(pageRecord(page, file))
            continue
          } catch (error) {
            failure = failure || String((error && error.message) || error)
          }
        }
        failure = failure || 'callReadPdf 返回了无法识别的结果'
      }
      attempts.push({ backend, available: true, produced: pages.length, requested: wanted.length, error: failure })
      if (pages.length > 0) {
        return { status: pages.length === wanted.length || total === null ? 'ok' : 'failed', backend: 'mineru-page', pages, attempts, pageCount: total, pageCountSource: totalInfo.source, ...(failure ? { reason: '部分页失败：' + failure } : {}) }
      }
      continue
    }

    attempts.push({ backend, available: false, reason: '未知后端（不在 rendererOrder 支持范围内）' })
  }

  // Safeguard 4: explicit reason + advice, caller downgrades to checklist-only.
  const advice = order.map((b) => INSTALL_ADVICE[b]).filter(Boolean).join(' ')
  return {
    status: 'skipped',
    backend: null,
    pages: [],
    rendererDowngrade: true,
    reason:
      '无可用页图后端（尝试顺序：' +
      order.join(' → ') +
      '）。' +
      attempts.map((a) => a.backend + ': ' + (a.reason || a.error || '未产出')).join('；'),
    advice: advice + ' 调用方应降级为「只给 checklist」的人工核对清单。',
    attempts,
    pageCount: total,
    pageCountSource: totalInfo.source,
  }
}
