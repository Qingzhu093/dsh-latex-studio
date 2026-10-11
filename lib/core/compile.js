/**
 * Multi-pass LaTeX build driver (pure Node ESM, no DSH imports).
 *
 * latexmk is NOT usable here: MiKTeX ships it as a Perl script and this machine
 * has no Perl (INTERFACES §0). This module drives the engine directly:
 *
 *   engine -> (bibtex | biber, when the .aux/.bcf asks for it) -> engine again,
 *   repeating until the .aux fingerprint stops changing, at most 4 engine passes.
 *
 * Every missing external piece degrades to `status: 'skipped'` plus advice; the
 * module never throws at the caller.
 * @module dsh-latex-studio/core/compile
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { resolveTool, probeEnv } from './env.js'
import { auxFingerprint, needsRerun, parseLatexLog } from './logparse.js'

/** Maximum engine passes before we accept the current state. */
export const MAX_PASSES = 4

const LOG_TAIL_LINES = 40

/**
 * Infer the engine a document needs from its source.
 * @param {string} [texSource] - .tex contents; when absent, `dir` is scanned.
 * @param {string} [dir] - project directory used when texSource is missing.
 * @returns {'pdflatex'|'xelatex'|'lualatex'}
 */
export function detectEngine(texSource, dir) {
  let source = typeof texSource === 'string' ? texSource : ''
  if (source.trim() === '' && typeof dir === 'string' && dir) {
    for (const candidate of [join(dir, 'main.tex'), ...listTexFiles(dir)]) {
      try {
        source = readFileSync(candidate, 'utf8')
        break
      } catch {
        /* try the next candidate */
      }
    }
  }
  if (/\\directlua|\\usepackage(?:\[[^\]]*\])?\{(?:luacode|luatexbase|luatex85)\}/.test(source)) return 'lualatex'
  if (
    /\\usepackage(?:\[[^\]]*\])?\{(?:fontspec|unicode-math|xeCJK|ctex|polyglossia|mathspec|metalogo)\}/.test(source) ||
    /\\set(?:main|sans|mono)CJK?font|\\setmathfont|\\XeTeX|\\documentclass(?:\[[^\]]*\])?\{ctex/.test(source)
  ) {
    return 'xelatex'
  }
  return 'pdflatex'
}

function listTexFiles(dir) {
  try {
    return readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith('.tex'))
      .map((name) => join(dir, name))
  } catch {
    return []
  }
}

/** Split an engineArgs string into argv entries, honouring quotes. */
export function splitEngineArgs(text) {
  if (typeof text !== 'string' || text.trim() === '') return []
  const out = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match
  while ((match = re.exec(text)) !== null) out.push(match[1] ?? match[2] ?? match[3])
  return out
}

function readTextSafe(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function tailLines(text, count = LOG_TAIL_LINES) {
  if (typeof text !== 'string') return ''
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  return lines.slice(Math.max(0, lines.length - count)).join('\n')
}

/** Kill a process tree (Windows engines spawn helpers). */
function killTree(child) {
  if (!child) return
  try {
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 })
    }
  } catch {
    /* fall through to child.kill */
  }
  try {
    child.kill('SIGKILL')
  } catch {
    /* already gone */
  }
}

/**
 * Run one child process to completion.
 * @returns {Promise<{code:number|null, signal:string|null, timedOut:boolean, stdout:string, stderr:string}>}
 */
function runProcess(command, args, { cwd, env, timeoutMs, stdinClosed = true } = {}) {
  return new Promise((settle) => {
    let child
    try {
      child = spawn(command, args, {
        cwd,
        env,
        windowsHide: true,
        stdio: [stdinClosed ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      settle({ code: null, signal: null, timedOut: false, stdout: '', stderr: String(error?.message ?? error), spawnError: true })
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const cap = 4 * 1024 * 1024
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, Math.max(1000, timeoutMs || 0))
    child.stdout?.on('data', (chunk) => {
      if (stdout.length < cap) stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < cap) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      settle({ code: null, signal: null, timedOut, stdout, stderr: stderr + '\n' + String(error?.message ?? error), spawnError: true })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      settle({ code, signal, timedOut, stdout, stderr })
    })
  })
}

/** Build the engine argv for one pass. */
function engineArgv({ binary, base, dir, buildDir, auxDir, isMiKTeX, config }) {
  const args = []
  args.push('-interaction=nonstopmode')
  args.push('-file-line-error')
  args.push('-output-directory=' + buildDir)
  args.push('-aux-directory=' + auxDir)
  // Keep one logical message on one physical line so the log stays parseable.
  args.push('--max-print-line=1000')
  if (isMiKTeX && config.enableInstaller !== false) args.push('--enable-installer')
  for (const extra of splitEngineArgs(config.engineArgs)) args.push(extra)
  args.push(base + '.tex')
  return args
}

/** Decide whether the bibliography needs bibtex or biber after a pass. */
function detectBibNeed(auxDir, base) {
  if (existsSync(join(auxDir, base + '.bcf'))) return 'biber'
  const aux = readTextSafe(join(auxDir, base + '.aux'))
  if (aux && /\\(bibdata|bibstyle|citation\{)/.test(aux)) return 'bibtex'
  return null
}

function engineEnv(dir, auxDir, base) {
  const env = { ...process.env }
  const join3 = (a, b) => (a ? a + ';' : '') + b
  env.TEXINPUTS = join3(dir, auxDir + ';')
  env.BIBINPUTS = join3(env.BIBINPUTS || '', dir + ';')
  env.BSTINPUTS = join3(env.BSTINPUTS || '', dir + ';')
  env.max_print_line = env.max_print_line || '1000'
  return env
}

/**
 * Compile a LaTeX project with a self-contained multi-pass driver.
 *
 * @param {{dir:string, entry?:string, engine?:string, clean?:boolean, config?:object}} opts
 * @returns {Promise<object>} BuildResult (INTERFACES §3). Never throws.
 */
export async function build(opts = {}) {
  const started = Date.now()
  const advice = []
  const finish = (result) => ({
    engine: null,
    passes: 0,
    durationMs: Date.now() - started,
    pdfPath: null,
    logPath: null,
    pages: null,
    logTail: '',
    advice,
    ...result,
  })
  try {
    const config = opts.config && typeof opts.config === 'object' ? opts.config : {}
    const dir = resolve(String(opts.dir || process.cwd()))
    const timeoutMs = Number.isFinite(Number(config.compileTimeoutMs)) && Number(config.compileTimeoutMs) > 0
      ? Number(config.compileTimeoutMs)
      : 300000

    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      return finish({ status: 'skipped', reason: 'PROJECT_DIR_NOT_FOUND', ...parseLatexLog('') })
    }

    const requestedEntry = typeof opts.entry === 'string' && opts.entry.trim() !== '' ? opts.entry.trim() : null
    let entryName = requestedEntry
    if (!entryName) {
      const candidates = ['main.tex', ...listTexFiles(dir).map((p) => basename(p))]
      entryName = candidates.find((name) => existsSync(join(dir, name))) ?? 'main.tex'
    }
    const entryPath = join(dir, entryName)
    if (!existsSync(entryPath)) {
      return finish({ status: 'skipped', reason: 'ENTRY_NOT_FOUND', entry: entryName, ...parseLatexLog('') })
    }
    const base = basename(entryName, extname(entryName))

    // --- engine selection -------------------------------------------------
    let engineName = typeof opts.engine === 'string' && opts.engine !== 'auto' ? opts.engine : null
    const configured = typeof config.latexCommand === 'string' ? config.latexCommand.trim() : ''
    if (!engineName && configured && configured.toLowerCase() !== 'auto' && !/latexmk$/i.test(configured)) {
      engineName = configured
    }
    if (configured && /latexmk$/i.test(configured)) {
      advice.push({ level: 'warn', message: 'latexCommand=latexmk 已被忽略（本机无 Perl）；改用直接驱动引擎。' })
    }
    const auto = !engineName
    if (!engineName) engineName = detectEngine(readTextSafe(entryPath) ?? '', dir)

    const enginePath = resolveTool(engineName)
    if (!enginePath) {
      return finish({
        status: 'skipped',
        engine: engineName,
        reason: 'ENGINE_NOT_FOUND',
        entry: entryName,
        ...parseLatexLog(''),
        advice: [...advice, {
          level: 'error',
          message: '找不到 TeX 引擎 ' + engineName + '（也未找到 pdflatex/xelatex/lualatex），本次编译跳过。',
          command: 'winget install MiKTeX.MiKTeX',
        }],
      })
    }

    let isMiKTeX = false
    try {
      const envReport = await probeEnv(config)
      isMiKTeX = envReport?.latex?.isMiKTeX === true
    } catch {
      isMiKTeX = /miktex/i.test(enginePath)
    }

    // --- directories ------------------------------------------------------
    // Everything generated goes under <dir>/<workDir> so the project root is
    // never polluted. The auxiliary directory MUST NOT be called 'aux': that is
    // a reserved DOS device name on Windows and breaks Copy-Item / Robocopy /
    // Explorer / zip tools.
    const workDirName = typeof config.workDir === 'string' && config.workDir.trim() !== ''
      ? config.workDir.trim()
      : '.latex-studio'
    const workDir = join(dir, workDirName)
    const buildDir = join(workDir, 'build')
    const auxDir = join(workDir, 'auxfiles')
    if (opts.clean === true) {
      for (const target of [buildDir, auxDir]) {
        try {
          rmSync(target, { recursive: true, force: true })
        } catch {
          /* best effort */
        }
      }
    }
    for (const target of [workDir, buildDir, auxDir]) {
      try {
        mkdirSync(target, { recursive: true })
      } catch (error) {
        return finish({
          status: 'failed', engine: engineName, reason: 'MKDIR_FAILED',
          ...parseLatexLog(''),
          advice: [...advice, { level: 'error', message: '无法创建输出目录 ' + target + '：' + String(error?.message ?? error) }],
        })
      }
    }

    // MiKTeX writes the .log next to the .aux (-aux-directory) while classic
    // setups write it next to the PDF (-output-directory): probe both.
    const logCandidates = [join(buildDir, base + '.log'), join(auxDir, base + '.log')]
    const findLog = () => logCandidates.find((candidate) => existsSync(candidate)) ?? null
    const auxPath = join(auxDir, base + '.aux')
    const pdfPath = join(buildDir, base + '.pdf')
    const argv = engineArgv({ binary: enginePath, base, dir, buildDir, auxDir, isMiKTeX, config })
    const env = engineEnv(dir, auxDir, base)

    // --- multi-pass loop --------------------------------------------------
    let report = parseLatexLog('')
    let logText = ''
    let enginePasses = 0
    let bibNeeded = null
    let bibDone = false
    let bibInfo = null
    let previousAux = null
    let timedOut = false

    for (let round = 1; round <= MAX_PASSES + 2; round += 1) {
      if (Date.now() - started > timeoutMs) {
        timedOut = true
        break
      }
      const remaining = timeoutMs - (Date.now() - started)
      const run = await runProcess(enginePath, argv, { cwd: dir, env, timeoutMs: remaining })
      enginePasses += 1
      const foundLog = findLog()
      logText = (foundLog ? readTextSafe(foundLog) : '') ?? ''
      report = parseLatexLog(logText)
      if (run.timedOut) {
        timedOut = true
        break
      }
      if (run.spawnError && logText === '') {
        return finish({
          status: 'failed', engine: engineName, passes: enginePasses, reason: 'ENGINE_SPAWN_FAILED',
          logPath: findLog(), logTail: tailLines(run.stderr || run.stdout), ...report,
          advice: [...advice, { level: 'error', message: '引擎启动失败：' + (run.stderr || run.stdout || 'unknown') }],
        })
      }
      if (report.errors.length > 0 && /Fatal error|Emergency stop/i.test(logText)) break
      if (report.errors.length > 0) break

      if (bibNeeded === null) bibNeeded = detectBibNeed(auxDir, base)
      if (bibNeeded && !bibDone) {
        bibDone = true
        previousAux = null
        const bibPath = resolveTool(bibNeeded)
        if (!bibPath) {
          advice.push({
            level: 'warn',
            message: '需要 ' + bibNeeded + ' 生成参考文献，但未找到该程序；参考文献条目将保持未解析。',
            command: bibNeeded === 'biber' ? 'mpm --install=biber' : '',
          })
          bibInfo = { tool: bibNeeded, ran: false, reason: 'BIB_TOOL_NOT_FOUND' }
        } else {
          const bibArgs = bibNeeded === 'biber'
            ? ['--input-directory', dir, '--output-directory', auxDir, base]
            : [base]
          const bibRun = await runProcess(bibPath, bibArgs, {
            cwd: auxDir,
            env,
            timeoutMs: Math.max(5000, Math.min(60000, remaining)),
          })
          bibInfo = { tool: bibNeeded, ran: true, exitCode: bibRun.code, timedOut: bibRun.timedOut }
          if (bibRun.code !== 0) {
            advice.push({
              level: 'warn',
              message: bibNeeded + ' 退出码 ' + String(bibRun.code) + '，参考文献可能不完整。',
            })
          }
        }
        continue
      }

      const auxText = readTextSafe(auxPath)
      const fingerprint = auxFingerprint(auxText ?? '')
      // An empty fingerprint means the `.aux` is missing or empty — i.e. the run
      // that should have produced cross-reference data did not produce any. Two
      // empty fingerprints are NOT evidence of convergence: treating them as
      // "stable" made a document with a forward `\ref` stop after 2 passes and
      // report `passed` with unresolved page numbers. Require a non-empty,
      // repeated fingerprint before declaring the run converged.
      const stable = previousAux !== null && fingerprint !== '' && fingerprint === previousAux
      const rerun = needsRerun(report)
      previousAux = fingerprint
      if (stable && !rerun) break
    }

    const finalLogPath = findLog()
    const finalLog = (finalLogPath ? readTextSafe(finalLogPath) : null) ?? logText
    report = parseLatexLog(finalLog)
    const pdfExists = existsSync(pdfPath)
    let status = timedOut ? 'failed' : report.compileSuccess && pdfExists ? 'passed' : 'failed'
    let reason = timedOut ? 'TIMEOUT' : status === 'failed' ? 'COMPILE_FAILED' : undefined
    if (!timedOut && finalLogPath === null) {
      status = 'failed'
      reason = 'LOG_NOT_FOUND'
      advice.push({ level: 'error', message: '引擎未产出 .log 文件，无法判定编译结果。' })
    }
    if (timedOut) {
      advice.push({ level: 'error', message: '编译超时（' + timeoutMs + 'ms），已终止引擎进程。' })
    }
    if (status === 'failed' && !pdfExists && report.errors.length === 0) {
      advice.push({ level: 'warn', message: '引擎结束但未产出 PDF；请检查日志尾部。' })
    }

    return finish({
      status,
      engine: engineName,
      enginePath,
      entry: entryName,
      entryAuto: auto,
      passes: enginePasses,
      durationMs: Date.now() - started,
      pdfPath: pdfExists ? pdfPath : null,
      logPath: finalLogPath,
      logTail: tailLines(finalLog),
      bib: bibInfo,
      reason,
      ...report,
    })
  } catch (error) {
    return finish({
      status: 'failed',
      reason: 'INTERNAL_ERROR',
      ...parseLatexLog(''),
      advice: [...advice, { level: 'error', message: '编译驱动内部错误：' + String(error?.message ?? error) }],
    })
  }
}
