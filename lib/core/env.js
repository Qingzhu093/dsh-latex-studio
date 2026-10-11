/**
 * Environment probing for dsh-latex-studio (pure Node ESM, no DSH imports).
 *
 * Resolves the TeX toolchain, Poppler and Python from the ambient environment.
 * Lookup order (see docs/INTERFACES.md §1):
 *   extraDirs -> PATH -> D:\MiKTeX\miktex\bin\x64 (mgs.exe, MiKTeX's bundled
 *   Ghostscript, is probed too as the zero-install page-render backend)
 *   -> %LOCALAPPDATA%\Programs\MiKTeX\miktex\bin\x64 -> registry InstallLocation
 *
 * latexmk is deliberately NOT resolved as a compile driver: MiKTeX ships it as
 * a Perl script and this machine has no Perl (P0 fact, INTERFACES §0).
 * @module dsh-latex-studio/core/env
 */

import { existsSync, statSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

/** TeX engines we drive directly (never latexmk). */
export const ENGINES = Object.freeze(['pdflatex', 'xelatex', 'lualatex'])

/** Well-known MiKTeX binary directories, in probe order. */
export function miktexBinCandidates() {
  const dirs = []
  dirs.push('D:\\MiKTeX\\miktex\\bin\\x64')
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData) dirs.push(join(localAppData, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'))
  dirs.push('C:\\Program Files\\MiKTeX\\miktex\\bin\\x64')
  dirs.push('C:\\Program Files (x86)\\MiKTeX\\miktex\\bin\\x64')
  return dirs
}

/** Extra directories that hold non-PATH MiKTeX helpers (biber lives here). */
function miktexExtraDirs() {
  return [
    'D:\\MiKTeX\\executables\\windows-x64\\biber',
    'D:\\MiKTeX\\miktex\\bin\\x64',
  ]
}

/** Poppler install locations commonly produced by scoop / winget / manual unzip. */
function popplerDirs() {
  const dirs = []
  const home = process.env.USERPROFILE || process.env.HOME
  if (home) {
    dirs.push(join(home, 'scoop', 'shims'))
    dirs.push(join(home, 'scoop', 'apps', 'poppler', 'current', 'bin'))
    dirs.push(join(home, 'scoop', 'apps', 'poppler', 'current', 'Library', 'bin'))
  }
  const programData = process.env.ProgramData
  if (programData) dirs.push(join(programData, 'chocolatey', 'bin'))
  dirs.push('C:\\poppler\\bin')
  dirs.push('C:\\Program Files\\poppler\\bin')
  return dirs
}

/** Registry InstallLocation for MiKTeX (best effort, never throws). */
function miktexRegistryBins() {
  if (process.platform !== 'win32') return []
  const out = []
  for (const key of [
    'HKLM\\SOFTWARE\\MiKTeX.org\\MiKTeX\\2.9',
    'HKCU\\SOFTWARE\\MiKTeX.org\\MiKTeX\\2.9',
    'HKLM\\SOFTWARE\\WOW6432Node\\MiKTeX.org\\MiKTeX\\2.9',
  ]) {
    try {
      const res = spawnSync('reg', ['query', key, '/v', 'InstallLocation'], {
        encoding: 'utf8',
        timeout: 4000,
        windowsHide: true,
      })
      const text = [res.stdout, res.stderr].filter(Boolean).join('\n')
      const match = /InstallLocation\s+REG_\w+\s+(.+)/i.exec(text)
      if (match && match[1]) {
        const root = match[1].trim()
        out.push(join(root, 'miktex', 'bin', 'x64'))
        out.push(join(root, 'bin', 'x64'))
        out.push(join(root, 'bin'))
      }
    } catch {
      /* registry unavailable: keep going */
    }
  }
  return out
}

/** PATH entries, ignoring empty and quoted entries. */
function pathDirs() {
  const raw = process.env.PATH || process.env.Path || ''
  return raw
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter((entry) => entry.length > 0)
}

/** Windows executable suffixes to try, in order. */
function suffixes() {
  if (process.platform !== 'win32') return ['']
  return ['', '.exe', '.cmd', '.bat', '.com']
}

function isFile(candidate) {
  try {
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

const resolveCache = new Map()

/**
 * Resolve one executable to an absolute path.
 * @param {string} name - tool name ('pdflatex', 'biber', ...) or a path.
 * @param {string[]} [extraDirs] - directories searched before PATH.
 * @returns {string|null} absolute path, or null when not found.
 */
export function resolveTool(name, extraDirs = []) {
  if (typeof name !== 'string' || name.trim() === '') return null
  const wanted = name.trim()
  const dirsIn = Array.isArray(extraDirs) ? extraDirs.filter((d) => typeof d === 'string' && d) : []
  const cacheKey = wanted + '\u0000' + dirsIn.join('\u0000')
  if (resolveCache.has(cacheKey)) return resolveCache.get(cacheKey)

  const suffixesToTry = suffixes()
  const finish = (value) => {
    resolveCache.set(cacheKey, value)
    return value
  }

  // Explicit path (absolute or containing a separator): probe it directly.
  if (isAbsolute(wanted) || wanted.includes(sep) || wanted.includes('/')) {
    for (const suffix of suffixesToTry) {
      if (isFile(wanted + suffix)) return finish(wanted + suffix)
    }
    return finish(null)
  }

  const dirs = [
    ...dirsIn,
    ...pathDirs(),
    ...miktexBinCandidates(),
    ...miktexExtraDirs(),
    ...popplerDirs(),
    ...miktexRegistryBins(),
  ]
  const seen = new Set()
  for (const dir of dirs) {
    if (!dir) continue
    const key = dir.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    for (const suffix of suffixesToTry) {
      const candidate = join(dir, wanted + suffix)
      if (isFile(candidate)) return finish(candidate)
    }
  }
  return finish(null)
}

/** Run '<tool> --version' and return a one-line version string (never throws). */
export function probeVersion(executable, args = ['--version'], timeoutMs = 10000) {
  if (!executable) return null
  try {
    const res = spawnSync(executable, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    })
    const text = [res.stdout, res.stderr].filter(Boolean).join('\n')
    const line = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0)
    return line ?? null
  } catch {
    return null
  }
}

function entryFor(name, extraDirs, versionArgs) {
  const path = resolveTool(name, extraDirs)
  return { path, version: path ? probeVersion(path, versionArgs) : null }
}

/**
 * Probe the whole environment once.
 * @param {Record<string, unknown>} [config] - normalized plugin config.
 * @returns {Promise<object>} EnvReport (INTERFACES §1).
 */
export async function probeEnv(config = {}) {
  const cfg = config && typeof config === 'object' ? config : {}
  const advice = []
  const popplerExtra = [cfg.popplerPath].filter((d) => typeof d === 'string' && d.length > 0)

  const enginePaths = {}
  const engineVersions = {}
  for (const engine of ENGINES) {
    const found = entryFor(engine, [])
    enginePaths[engine] = found.path
    engineVersions[engine] = found.version
  }

  const preferred = typeof cfg.latexCommand === 'string' ? cfg.latexCommand.trim() : ''
  const isLatexmk = /latexmk$/i.test(preferred)
  let command = null
  let commandPath = null
  let commandVersion = null
  if (preferred && !isLatexmk) {
    commandPath = resolveTool(preferred, [])
    command = commandPath ? preferred : null
    commandVersion = commandPath ? probeVersion(commandPath) : null
    if (!commandPath) {
      advice.push({
        level: 'error',
        message: '配置的 latexCommand 无法解析：' + preferred + '，将回退到自动探测引擎。',
        command: preferred + ' --version',
      })
    }
  }
  if (!command) {
    for (const engine of ENGINES) {
      if (enginePaths[engine]) {
        command = engine
        commandPath = enginePaths[engine]
        commandVersion = engineVersions[engine]
        break
      }
    }
  }
  if (isLatexmk) {
    advice.push({
      level: 'warn',
      message: '检测到 latexCommand=latexmk，但本机无 Perl，latexmk 不可用；已改为直接驱动 TeX 引擎。',
    })
  }

  const biber = entryFor('biber', miktexExtraDirs())
  const bibtex = entryFor('bibtex', [])
  const makeindex = entryFor('makeindex', [])
  const mpm = entryFor('mpm', [])
  const initexmf = entryFor('initexmf', [])
  let chktex = entryFor('miktex-chktex', [])
  if (!chktex.path) chktex = entryFor('chktex', [])

  const binDir = commandPath ? dirname(commandPath) : enginePaths.pdflatex ? dirname(enginePaths.pdflatex) : null
  const isMiKTeX =
    /miktex/i.test(commandVersion || '') ||
    /miktex/i.test(engineVersions.pdflatex || '') ||
    (binDir ? /miktex/i.test(binDir) : false)

  const pdftoppm = resolveTool('pdftoppm', popplerExtra)
  const pdfinfo = resolveTool('pdfinfo', popplerExtra)

  // MiKTeX ships Ghostscript (mgs.exe) - the zero-install local page-render
  // backend confirmed by the P0 probe (INTERFACES §0).
  const mgs = resolveTool('mgs', [])
  const ghostscript = { mgs, version: mgs ? probeVersion(mgs, ['--version']) : null }

  const readPdfToolName = typeof cfg.readPdfToolName === 'string' && cfg.readPdfToolName ? cfg.readPdfToolName : 'read_pdf'
  const uploadScope = cfg.uploadScope === 'always' || cfg.uploadScope === 'never' ? cfg.uploadScope : 'external-only'
  const mineruAvailable = cfg.readPdfAvailable !== false && uploadScope !== 'never'
  const mineru = {
    toolName: readPdfToolName,
    available: mineruAvailable,
    activeProvider: mineruAvailable ? 'official-v4' : null,
    uploadsData: mineruAvailable,
  }

  const pythonPath = resolveTool('python', []) || resolveTool('python3', [])
  const node = { version: process.version }

  if (!command) {
    advice.push({
      level: 'error',
      message: '未找到任何 TeX 引擎（pdflatex/xelatex/lualatex）。请安装 MiKTeX，或把 bin 目录加入 PATH。',
      command: 'winget install MiKTeX.MiKTeX',
    })
  }
  if (!pdftoppm && !pdfinfo) {
    advice.push({
      level: 'warn',
      message: mgs
        ? '未找到 Poppler（pdftoppm/pdfinfo）；已发现 MiKTeX Ghostscript (mgs.exe)，页图通道将使用 miktex-ghostscript 后端。'
        : "未找到 Poppler（pdftoppm/pdfinfo），也未找到 MiKTeX Ghostscript（mgs.exe）；页图通道将回退到 read_pdf({view:'page'})。",
      command: 'scoop install poppler',
    })
  }
  if (!biber.path) {
    advice.push({
      level: 'warn',
      message: '未找到 biber，biblatex 项目的参考文献将无法生成（bibtex 项目不受影响）。',
      command: 'mpm --install=biber',
    })
  }
  if (!chktex.path) {
    advice.push({
      level: 'info',
      message: '未找到 chktex / miktex-chktex，外部 lint 通道将标记为 skipped（内部规则仍然运行）。',
      command: 'mpm --install=chktex',
    })
  }
  if (!isMiKTeX && command) {
    advice.push({ level: 'info', message: '未检测到 MiKTeX；--enable-installer 自动装包参数将不会附加。' })
  }

  return {
    latex: {
      command,
      path: commandPath,
      version: commandVersion,
      engines: enginePaths,
      biber: biber.path,
      bibtex: bibtex.path,
      makeindex: makeindex.path,
      mpm: mpm.path,
      initexmf: initexmf.path,
      chktex: chktex.path,
      isMiKTeX,
      binDir,
    },
    poppler: { pdftoppm, pdfinfo },
    ghostscript,
    mineru,
    python: { path: pythonPath },
    node,
    config: {
      uploadScope,
      rendererOrder: Array.isArray(cfg.rendererOrder) && cfg.rendererOrder.length > 0
        ? [...cfg.rendererOrder]
        : ['poppler', 'miktex-ghostscript', 'mineru-page'],
    },
    advice,
  }
}

/** Exposed for tests: drop the resolve cache. */
export function _clearResolveCache() {
  resolveCache.clear()
}
