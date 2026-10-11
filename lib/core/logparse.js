/**
 * LaTeX .log parser (pure Node ESM, no DSH imports).
 *
 * Rules ported from PaperFit `scripts/parse_log.py` (MIT), extended with:
 *  - `-file-line-error` parsing, so an error can name file + line directly;
 *  - a parenthesis-stack file tracker as the fallback for classic `! ` errors;
 *  - rerun detection, which the multi-pass compile driver uses for stability.
 *
 * Never throws: malformed or truncated logs yield a best-effort report.
 * @module dsh-latex-studio/core/logparse
 */

/** Recognised source-file extensions while tracking the TeX file stack. */
const FILE_RE = /\(((?:[A-Za-z]:)?[^()\n]*?\.(?:tex|sty|cls|def|cfg|clo|fd|ldf|ltx|bbl|aux|bib))/g
/** `./main.tex:23: Undefined control sequence.` emitted by -file-line-error. */
const FILE_LINE_ERROR_RE = /^(?:\.\/)?((?:[A-Za-z]:)?[^:()\n]+?\.(?:tex|sty|cls|def|cfg|clo|fd|ldf|ltx|bbl|bib)):(\d+):\s*(.*)$/
/** Classic `! LaTeX Error: ...` error line. */
const BANG_ERROR_RE = /^!\s?(.*)$/
/** `l.23 \notacommand` context line carrying the source line number. */
const LINE_NO_RE = /^l\.(\d+)\s?(.*)$/
const OUTPUT_WRITTEN_RE = /Output written on [\s\S]{0,400}?\((\d+)\s+pages?/i
const FATAL_RE = /Fatal error|Emergency stop|No pages of output|! TeX capacity exceeded/i
const OVERFULL_RE = /Overfull \\([hv])box \(([0-9.]+)pt too wide\)\s*(.*)$/
const UNDERFULL_RE = /Underfull \\([hv])box \(badness ([0-9]+)\)\s*(.*)$/
const AT_LINES_RE = /(?:at lines?|detected at line)\s+(\d+)(?:--(\d+))?/
const UNDEF_REF_RE = /LaTeX Warning: Reference [`']([^`']+)[`'](?: on page \d+)? undefined/
const UNDEF_CITE_RE = /(?:LaTeX|Package \w+) Warning: Citation [`']([^`']+)[`'](?: on page \d+)? undefined/
const FLOAT_TOO_LARGE_RE = /LaTeX Warning: Float too large for page by ([0-9.]+)pt/
const PACKAGE_WARNING_RE = /^(?:Package|Class|Module)\s+(\w+)\s+Warning:\s*(.*)$/
const RERUN_RE = /(?:Label\(s\) may have changed|Rerun to get|Rerun LaTeX|Please \(re\)run)/i
const INPUT_LINE_RE = /on input line (\d+)/

/** Strip the `./` prefix engines emit for the current directory. */
function normalizeFile(file) {
  if (typeof file !== 'string') return null
  return file.replace(/^\.\//, '').trim() || null
}

/** Approximate the current input file for every log line. */
function trackFiles(lines) {
  const current = new Array(lines.length).fill(null)
  const stack = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    FILE_RE.lastIndex = 0
    let match
    while ((match = FILE_RE.exec(line)) !== null) {
      stack.push(normalizeFile(match[1]))
    }
    let closes = 0
    for (let c = 0; c < line.length; c += 1) if (line[c] === ')') closes += 1
    for (let c = 0; c < closes && stack.length > 0; c += 1) stack.pop()
    current[i] = stack.length > 0 ? stack[stack.length - 1] : null
  }
  return current
}

/** First .tex file named anywhere in the log (last-resort attribution). */
function firstTexFile(lines) {
  for (const line of lines) {
    FILE_RE.lastIndex = 0
    let match
    while ((match = FILE_RE.exec(line)) !== null) {
      const file = normalizeFile(match[1])
      if (file && file.toLowerCase().endsWith('.tex')) return file
    }
  }
  return null
}

/** Nearest `l.<n>` line number around `index`. */
function nearbyLineNumber(lines, index) {
  for (let offset = 0; offset <= 4; offset += 1) {
    for (const idx of [index + offset, index - offset]) {
      if (idx < 0 || idx >= lines.length) continue
      const match = LINE_NO_RE.exec(lines[idx])
      if (match) return Number(match[1])
    }
  }
  return null
}

function emptyReport() {
  return {
    compileSuccess: true,
    pages: null,
    errors: [],
    warnings: [],
    overfull: [],
    underfull: [],
    missingCitations: [],
    missingRefs: [],
    floatWarnings: [],
    packageWarnings: [],
  }
}

/**
 * Parse a LaTeX log.
 * @param {string} text - contents of the .log file (may be empty or null).
 * @returns {object} LogReport (INTERFACES §2).
 */
export function parseLatexLog(text) {
  const report = emptyReport()
  if (typeof text !== 'string' || text.length === 0) return report
  let lines
  try {
    lines = text.replace(/\r\n?/g, '\n').split('\n')
  } catch {
    return report
  }
  const fileStack = trackFiles(lines)
  const fallbackTex = firstTexFile(lines)

  const errorKeys = new Set()
  const addError = (file, line, message, raw) => {
    const clean = String(message ?? '').trim()
    if (clean === '') return
    const key = (file || '') + '|' + (line ?? '') + '|' + clean
    if (errorKeys.has(key)) return
    errorKeys.add(key)
    report.errors.push({
      file: file ?? fallbackTex,
      line: line ?? null,
      message: clean,
      raw: raw ?? clean,
    })
  }

  // --- errors -------------------------------------------------------------
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const fl = FILE_LINE_ERROR_RE.exec(line)
    if (fl) {
      let message = fl[3].replace(/^!\s?/, '').trim()
      // pdfTeX wraps long log lines at 79 columns, so an error message can span
      // up to a couple of physical lines before the `l.<n>` context line.
      for (let j = i + 1; j < lines.length && j <= i + 2; j += 1) {
        const next = lines[j]
        if (!next || LINE_NO_RE.test(next) || next.startsWith('!') || next.trim() === '') break
        if (/[.!?:]\s*$/.test(message)) break
        message = (message + ' ' + next.trim()).trim()
      }
      addError(normalizeFile(fl[1]), Number(fl[2]), message, line)
      continue
    }
    const bang = BANG_ERROR_RE.exec(line)
    if (bang) {
      const message = bang[1].trim()
      // "! Emergency stop." / "! ==> Fatal error occurred" are terminal markers.
      if (/^(==>\s*)?Fatal error occurred/i.test(message)) continue
      addError(fileStack[i], nearbyLineNumber(lines, i), message, line)
    }
  }
  if (report.errors.length === 0 && FATAL_RE.test(text)) {
    const idx = lines.findIndex((l) => FATAL_RE.test(l))
    addError(idx >= 0 ? fileStack[idx] : null, idx >= 0 ? nearbyLineNumber(lines, idx) : null, 'Fatal error / emergency stop', idx >= 0 ? lines[idx] : null)
  }

  // --- pages / success ----------------------------------------------------
  const out = OUTPUT_WRITTEN_RE.exec(text)
  report.pages = out ? Number(out[1]) : null
  const fatal = FATAL_RE.test(text)
  if (fatal) report.compileSuccess = false
  else if (report.errors.length > 0) report.compileSuccess = false
  else report.compileSuccess = true

  // --- overfull / underfull ----------------------------------------------
  const pushBox = (kind, array, entry, i) => {
    array.push(entry)
    report.warnings.push({
      file: fileStack[i] ?? fallbackTex,
      line: entry.line,
      message: entry.text,
      kind,
    })
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const over = OVERFULL_RE.exec(line)
    if (over) {
      const at = AT_LINES_RE.exec(line) || AT_LINES_RE.exec(lines[i + 1] ?? '')
      pushBox('overfull', report.overfull, {
        file: fileStack[i] ?? fallbackTex,
        line: at ? Number(at[1]) : null,
        amountPt: Number(over[2]),
        text: (over[3] || line).trim(),
      }, i)
      continue
    }
    const under = UNDERFULL_RE.exec(line)
    if (under) {
      const at = AT_LINES_RE.exec(line) || AT_LINES_RE.exec(lines[i + 1] ?? '')
      pushBox('underfull', report.underfull, {
        file: fileStack[i] ?? fallbackTex,
        line: at ? Number(at[1]) : null,
        amountPt: null,
        text: ('badness ' + under[2] + ' ' + (under[3] || '')).trim(),
      }, i)
    }
  }

  // --- undefined references / citations ----------------------------------
  const refSeen = new Set()
  const citeSeen = new Set()
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const ref = UNDEF_REF_RE.exec(line)
    if (ref && !refSeen.has(ref[1])) {
      refSeen.add(ref[1])
      report.missingRefs.push(ref[1])
      report.warnings.push({ file: fileStack[i] ?? fallbackTex, line: nearbyLineNumber(lines, i), message: 'Reference undefined: ' + ref[1], kind: 'undefined-reference' })
    }
    const cite = UNDEF_CITE_RE.exec(line)
    if (cite && !citeSeen.has(cite[1])) {
      citeSeen.add(cite[1])
      report.missingCitations.push(cite[1])
      report.warnings.push({ file: fileStack[i] ?? fallbackTex, line: nearbyLineNumber(lines, i), message: 'Citation undefined: ' + cite[1], kind: 'undefined-citation' })
    }
  }

  // --- float + package warnings ------------------------------------------
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const float = FLOAT_TOO_LARGE_RE.exec(line)
    if (float) {
      const entry = { file: fileStack[i] ?? fallbackTex, line: nearbyLineNumber(lines, i), overflowPt: Number(float[1]), message: line.trim() }
      report.floatWarnings.push(entry)
      report.warnings.push({ file: entry.file, line: entry.line, message: entry.message, kind: 'float' })
    }
    const pkg = PACKAGE_WARNING_RE.exec(line)
    if (pkg) {
      const inputLine = INPUT_LINE_RE.exec(line)
      const entry = { package: pkg[1], file: fileStack[i] ?? fallbackTex, line: inputLine ? Number(inputLine[1]) : null, message: pkg[2].trim() }
      report.packageWarnings.push(entry)
      report.warnings.push({ file: entry.file, line: entry.line, message: '[' + entry.package + '] ' + entry.message, kind: 'package' })
    }
    if (RERUN_RE.test(line)) {
      report.warnings.push({ file: fileStack[i] ?? fallbackTex, line: null, message: line.trim(), kind: 'rerun' })
    }
  }

  // Cap warning volume: long documents can emit hundreds of box warnings.
  if (report.warnings.length > 500) report.warnings = report.warnings.slice(0, 500)
  return report
}

/** Convenience: true when the log says another pass is needed. */
export function needsRerun(report) {
  return Array.isArray(report?.warnings) && report.warnings.some((w) => w.kind === 'rerun')
}

/**
 * Extract the stable part of a .aux file (\newlabel lines) for pass comparison.
 * @param {string} text - .aux contents.
 * @returns {string} normalized fingerprint.
 */
export function auxFingerprint(text) {
  if (typeof text !== 'string') return ''
  const labels = []
  for (const line of text.split(/\r?\n/)) {
    if (line.includes('\\newlabel')) labels.push(line.trim())
  }
  return labels.sort().join('\n')
}
