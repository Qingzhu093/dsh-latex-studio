/**
 * BibTeX/biblatex handling (pure Node ESM, no DSH imports).
 *
 * - `parseBib` is a self-contained, brace-balanced .bib parser; `complete` is
 *   false whenever an entry is left unclosed (the classic "missing }" defect).
 * - `bibAction` implements lint / format / fill / audit. MiKTeX biber is used as
 *   an external linter when available (INTERFACES §5); Crossref fill only ever
 *   *adds* missing fields.
 * - Every write path validates `complete` first and refuses with
 *   `PARSE_INCOMPLETE`; a backup is taken before the write and restored on a
 *   post-write verification failure.
 *
 * Never throws at the caller.
 * @module dsh-latex-studio/core/bib
 */

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { resolveTool } from './env.js'
import { extractProtected } from './lint.js'

const CROSSREF_ENDPOINT = 'https://api.crossref.org/works'
const MAX_CROSSREF_LOOKUPS = 5

/** Field order used when formatting an entry back to disk. */
const FIELD_ORDER = ['author', 'editor', 'title', 'journal', 'booktitle', 'publisher', 'institution', 'school', 'year', 'volume', 'number', 'pages', 'doi', 'url', 'note']

/** Fields a bibliography entry is normally expected to carry. */
const REQUIRED_FIELDS = ['title', 'year']
const AUTHOR_FIELDS = ['author', 'editor']

/**
 * Find the end of an entry body that starts right after its opening brace/paren.
 * Nesting depth starts at 0, so the matching close is the first closer seen at
 * depth 0; running out of text means the entry was never closed.
 */
function matchBodyEnd(text, start) {
  let depth = 0
  let quote = false
  let i = start
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '"') quote = !quote
    else if (!quote) {
      if (ch === '{' || ch === '(') depth += 1
      else if (ch === '}' || ch === ')') {
        if (depth === 0) return { end: i, closed: true }
        depth -= 1
      }
    }
    i += 1
  }
  return { end: text.length, closed: false }
}

/** Read one field value starting at \`from\`, returning its text and end index. */
function readFieldValue(text, from) {
  let i = from
  while (i < text.length && /\s/.test(text[i])) i += 1
  if (i >= text.length) return { value: '', end: i, terminated: false }
  const first = text[i]
  if (first === '{') {
    const { end, closed } = matchBodyEnd(text, i + 1)
    return { value: text.slice(i + 1, end), end: closed ? end + 1 : end, terminated: closed }
  }
  if (first === '"') {
    let j = i + 1
    while (j < text.length && text[j] !== '"') j += 1
    return { value: text.slice(i + 1, j), end: j + 1, terminated: j < text.length }
  }
  let j = i
  while (j < text.length && text[j] !== ',' && text[j] !== '\n') j += 1
  return { value: text.slice(i, j).trim(), end: j, terminated: true }
}

/** Parse one entry body (key + fields). */
function parseEntryBody(body) {
  const fields = {}
  const order = []
  let key = null
  let cursor = 0
  const keyMatch = /^\s*([^,\s{}()]+)\s*,/.exec(body)
  if (keyMatch) {
    key = keyMatch[1].trim()
    cursor = keyMatch[0].length
  } else {
    const bare = /^\s*([^,\s{}()]+)\s*$/.exec(body)
    if (bare) {
      key = bare[1].trim()
      cursor = body.length
    }
  }
  const fieldRe = /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*/g
  fieldRe.lastIndex = cursor
  let match
  while ((match = fieldRe.exec(body)) !== null) {
    const name = match[1].toLowerCase()
    const { value, end, terminated } = readFieldValue(body, fieldRe.lastIndex)
    if (!terminated) break
    if (!Object.hasOwn(fields, name)) {
      fields[name] = value.replace(/\s+/g, ' ').trim()
      order.push(name)
    }
    fieldRe.lastIndex = end
  }
  return { key, fields, order }
}

/**
 * Parse a .bib file.
 * @param {string} text - .bib contents.
 * @returns {{entries:Array<{key:string|null,type:string,fields:object,raw:string,line:number}>, complete:boolean}}
 */
export function parseBib(text) {
  const entries = []
  if (typeof text !== 'string' || text.trim() === '') return { entries: [], complete: true }
  let complete = true
  let cursor = 0
  while (cursor < text.length) {
    const at = text.indexOf('@', cursor)
    if (at === -1) break
    const head = /^@([A-Za-z]+)\s*([{(])/.exec(text.slice(at))
    if (!head) {
      // A stray '@' outside an entry head: tolerate but flag.
      if (/^@[A-Za-z]+\s*[^\s{(]/.test(text.slice(at, at + 40))) complete = false
      cursor = at + 1
      continue
    }
    const type = head[1].toLowerCase()
    const start = at + head[0].length
    const { end, closed } = matchBodyEnd(text, start)
    const body = text.slice(start, end)
    if (!closed) complete = false
    if (type !== 'comment' && type !== 'preamble' && type !== 'string') {
      const parsed = parseEntryBody(body)
      if (!parsed.key) complete = false
      entries.push({
        key: parsed.key,
        type,
        fields: parsed.fields,
        order: parsed.order,
        line: text.slice(0, at).split('\n').length,
        raw: text.slice(at, closed ? end + 1 : end),
      })
    }
    if (!closed) break
    cursor = end + 1
  }
  return { entries, complete }
}

function issue(code, severity, message, extra = {}) {
  return { code, severity, message, ...extra }
}

/** Structural issues that do not need an external tool. */
function internalIssues(parsed) {
  const issues = []
  if (!parsed.complete) {
    issues.push(issue('PARSE_INCOMPLETE', 'error', '.bib 结构不完整：有条目缺少闭合括号。'))
  }
  const seen = new Map()
  for (const entry of parsed.entries) {
    if (!entry.key) issues.push(issue('MISSING_KEY', 'error', '存在没有引用键的条目（第 ' + entry.line + ' 行）。', { line: entry.line }))
    else if (seen.has(entry.key)) issues.push(issue('DUPLICATE_KEY', 'error', '引用键重复：' + entry.key + '（首次第 ' + seen.get(entry.key) + ' 行）。', { key: entry.key, line: entry.line }))
    else if (entry.key) seen.set(entry.key, entry.line)
    for (const field of REQUIRED_FIELDS) {
      if (!entry.fields[field]) {
        issues.push(issue('MISSING_FIELD', 'warn', '条目 ' + (entry.key ?? '?') + ' 缺少 ' + field + ' 字段。', { key: entry.key, field, line: entry.line }))
      }
    }
    if (!AUTHOR_FIELDS.some((field) => entry.fields[field])) {
      issues.push(issue('MISSING_AUTHOR', 'warn', '条目 ' + (entry.key ?? '?') + ' 缺少 author/editor 字段。', { key: entry.key, line: entry.line }))
    }
  }
  return issues
}

/** Run MiKTeX biber in tool mode as an external linter (never fatal). */
function runBiberTool(bibPath, timeoutMs) {
  const binary = resolveTool('biber', [])
  if (!binary) return { state: 'skipped', issues: [] }
  let scratch = null
  try {
    scratch = mkdtempSync(join(tmpdir(), 'dsh-bib-'))
    const result = spawnSync(binary, ['--tool', '--quiet', '--logfile', join(scratch, 'biber.log'), '--output-format=bibtex', '--output-file', join(scratch, 'out.bib'), bibPath], {
      encoding: 'utf8',
      timeout: Math.max(5000, Math.min(timeoutMs, 120000)),
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    })
    if (result.error) return { state: 'error', issues: [] }
    const text = ((result.stdout || '') + '\n' + (result.stderr || '')).replace(/\r\n?/g, '\n')
    const issues = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      const warn = /^WARN\s*-\s*(.*)$/.exec(trimmed)
      const error = /^ERROR\s*-\s*(.*)$/.exec(trimmed)
      if (error) issues.push(issue('BIBER_ERROR', 'error', error[1]))
      else if (warn) issues.push(issue('BIBER_WARN', 'warn', warn[1]))
      if (issues.length >= 100) break
    }
    return { state: 'used', issues, exitCode: result.status }
  } catch {
    return { state: 'error', issues: [] }
  } finally {
    if (scratch) {
      try {
        rmSync(scratch, { recursive: true, force: true })
      } catch {
        /* best effort */
      }
    }
  }
}

/** Serialize entries back to a deterministic .bib text. */
function formatEntries(entries) {
  const blocks = []
  for (const entry of entries) {
    const names = [...entry.order]
    const sorted = [
      ...FIELD_ORDER.filter((name) => names.includes(name)),
      ...names.filter((name) => !FIELD_ORDER.includes(name)),
    ]
    const width = sorted.reduce((max, name) => Math.max(max, name.length), 0)
    const lines = sorted.map((name) => '  ' + name.padEnd(width) + ' = {' + String(entry.fields[name] ?? '').trim() + '},')
    if (lines.length > 0) lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '')
    blocks.push('@' + entry.type + '{' + entry.key + ',\n' + lines.join('\n') + '\n}')
  }
  return blocks.join('\n\n') + (blocks.length > 0 ? '\n' : '')
}

function readTexSources(texFiles, baseDir) {
  const sources = []
  for (const file of Array.isArray(texFiles) ? texFiles : []) {
    if (typeof file === 'string') {
      const path = baseDir ? join(baseDir, file) : file
      try {
        sources.push({ path, text: readFileSync(path, 'utf8') })
      } catch {
        sources.push({ path, text: '' })
      }
    } else if (file && typeof file.text === 'string') {
      sources.push({ path: String(file.path ?? '<inline>'), text: file.text })
    }
  }
  return sources
}

/** Guarded write: backup -> write -> re-parse -> restore on failure. */
function guardedWrite(bibPath, text) {
  const backupPath = bibPath + '.bak'
  try {
    if (existsSync(bibPath)) copyFileSync(bibPath, backupPath)
    writeFileSync(bibPath, text, 'utf8')
  } catch (error) {
    return { written: false, error: { code: 'WRITE_FAILED', message: String(error?.message ?? error) } }
  }
  // The re-read is INSIDE its own guard on purpose: if it fails (file locked or
  // removed between write and verify) the new text is already on disk, so the
  // only correct behaviour is to restore the backup — throwing here would leave
  // the file overwritten and unverified while the caller reports INTERNAL_ERROR.
  let verifyText = null
  try {
    verifyText = readFileSync(bibPath, 'utf8')
  } catch {
    verifyText = null
  }
  const verify = verifyText === null ? { complete: false } : parseBib(verifyText)
  if (verifyText === null || !verify.complete) {
    let restored = false
    try {
      if (existsSync(backupPath)) {
        copyFileSync(backupPath, bibPath)
        restored = true
      }
    } catch {
      /* best effort */
    }
    return {
      written: false,
      error: {
        code: 'VERIFY_FAILED',
        message: verifyText === null
          ? '写入后无法读回文件进行校验，' + (restored ? '已回滚。' : '回滚失败，请检查 ' + backupPath + '。')
          : '写入后校验失败（结构不完整），' + (restored ? '已回滚。' : '回滚失败，请检查 ' + backupPath + '。'),
      },
    }
  }
  return { written: true, backupPath }
}

/** Crossref lookup for one entry (best effort, only fills gaps). */
async function crossrefFill(entry) {
  const title = entry.fields.title
  if (!title) return null
  const url = CROSSREF_ENDPOINT + '?rows=1&select=DOI,title,author,issued,container-title,type&query.bibliographic=' + encodeURIComponent(title)
  const response = await fetch(url, { headers: { 'User-Agent': 'dsh-latex-studio/0.1 (bib fill)' } })
  if (!response.ok) throw new Error('Crossref HTTP ' + response.status)
  const payload = await response.json()
  const item = payload?.message?.items?.[0]
  if (!item) return null
  const added = {}
  if (!entry.fields.doi && item.DOI) added.doi = item.DOI
  if (!entry.fields.year && item.issued?.['date-parts']?.[0]?.[0]) added.year = String(item.issued['date-parts'][0][0])
  if (!entry.fields.journal && item['container-title']?.[0]) added.journal = item['container-title'][0]
  if (!entry.fields.author && Array.isArray(item.author) && item.author.length > 0) {
    added.author = item.author
      .map((person) => (person.family ? [person.family, person.given].filter(Boolean).join(', ') : person.name))
      .filter(Boolean)
      .join(' and ')
  }
  return Object.keys(added).length > 0 ? added : null
}

/**
 * Run one bibliography action.
 * @param {{action:'lint'|'format'|'fill'|'audit', bibPath:string, texFiles?:string[]|Array<{path?:string,text:string}>, write?:boolean, config?:object, baseDir?:string}} opts
 * @returns {Promise<object>} BibResult (INTERFACES §5). Never throws.
 */
export async function bibAction(opts = {}) {
  const action = opts.action
  const bibPath = typeof opts.bibPath === 'string' ? opts.bibPath : ''
  const advice = []
  const base = {
    ok: false,
    action,
    issues: [],
    advice,
  }
  if (!['lint', 'format', 'fill', 'audit'].includes(action)) {
    return { ...base, error: { code: 'BAD_ACTION', message: '不支持的 action：' + String(action) } }
  }
  if (!bibPath || !existsSync(bibPath)) {
    return { ...base, error: { code: 'BIB_NOT_FOUND', message: '.bib 文件不存在：' + bibPath } }
  }
  let text
  try {
    text = readFileSync(bibPath, 'utf8')
  } catch (error) {
    return { ...base, error: { code: 'BIB_READ_FAILED', message: String(error?.message ?? error) } }
  }
  const parsed = parseBib(text)
  const issues = internalIssues(parsed)
  const timeoutMs = Number(opts.config?.compileTimeoutMs) || 60000

  try {
    if (action === 'lint') {
      const biber = runBiberTool(bibPath, timeoutMs)
      issues.push(...biber.issues)
      if (biber.state === 'skipped') advice.push({ level: 'info', message: '未找到 biber，外部 bib 校验通道已跳过（内部解析仍然生效）。', command: 'mpm --install=biber' })
      else if (biber.state === 'error') advice.push({ level: 'warn', message: 'biber --tool 运行失败，已忽略其输出。' })
      const ok = !issues.some((item) => item.severity === 'error')
      return { ...base, ok, issues, external: { biber: biber.state } }
    }

    if (action === 'format') {
      if (!parsed.complete) {
        return { ...base, ok: false, written: false, issues, error: { code: 'PARSE_INCOMPLETE', message: '结构不完整，拒绝格式化写入。' } }
      }
      const fixed = formatEntries(parsed.entries)
      const result = { ...base, ok: true, issues, fixed }
      if (opts.write === true) {
        const written = guardedWrite(bibPath, fixed)
        if (!written.written) return { ...result, ok: false, written: false, error: written.error }
        result.written = true
        result.backupPath = written.backupPath
      } else {
        result.written = false
      }
      return result
    }

    if (action === 'fill') {
      // Mirror `format`: refuse to operate on a structurally broken file at all.
      // Doing the Crossref lookups first and only checking `complete` at the
      // write step wasted a network round trip and, with no fillable entry,
      // reported ok:true for a file whose parse had silently truncated.
      if (!parsed.complete) {
        return {
          ...base,
          ok: false,
          written: false,
          issues,
          error: { code: 'PARSE_INCOMPLETE', message: '结构不完整，拒绝补全（可能把截断的解析结果写回）。' },
          advice: [...advice, { level: 'error', message: '先用 bib_tool lint 修正 .bib 的花括号/引号配对，再执行 fill。' }],
        }
      }
      const missing = parsed.entries.filter((entry) => !entry.fields.doi || !entry.fields.year)
      const targets = missing.slice(0, MAX_CROSSREF_LOOKUPS)
      const additions = new Map()
      let networkError = null
      for (const entry of targets) {
        try {
          const added = await crossrefFill(entry)
          if (added && entry.key) additions.set(entry.key, added)
        } catch (error) {
          networkError = String(error?.message ?? error)
          break
        }
      }
      if (networkError) {
        return {
          ...base,
          ok: false,
          issues,
          error: { code: 'CROSSREF_UNAVAILABLE', message: 'Crossref 查询失败：' + networkError },
          advice: [...advice, { level: 'warn', message: '网络不可用时不要编造文献信息，请手动提供 DOI。' }],
        }
      }
      const filled = parsed.entries.map((entry) => {
        const added = additions.get(entry.key)
        if (!added) return entry
        return { ...entry, fields: { ...entry.fields, ...added }, order: [...entry.order, ...Object.keys(added).filter((name) => !entry.order.includes(name))] }
      })
      const addedCount = additions.size
      const result = { ...base, ok: true, issues, fixed: formatEntries(filled), added: Object.fromEntries(additions) }
      if (opts.write === true && addedCount > 0) {
        const written = guardedWrite(bibPath, result.fixed)
        if (!written.written) return { ...result, ok: false, written: false, error: written.error }
        result.written = true
        result.backupPath = written.backupPath
      } else {
        result.written = false
      }
      return result
    }

    // action === 'audit'
    const sources = readTexSources(opts.texFiles, opts.baseDir)
    const protectedSet = extractProtected(sources)
    const cited = new Set(protectedSet.cites)
    if (cited.has('*')) cited.delete('*')
    const bibKeys = new Set(parsed.entries.map((entry) => entry.key).filter(Boolean))
    const missingInBib = [...cited].filter((key) => !bibKeys.has(key)).sort()
    const uncited = [...bibKeys].filter((key) => !cited.has(key)).sort()
    if (sources.length === 0) advice.push({ level: 'warn', message: '未提供 tex 文件，audit 只能列出全部未引用条目。' })
    for (const key of missingInBib) issues.push(issue('CITED_NOT_IN_BIB', 'error', '引用键 ' + key + ' 在 .bib 中不存在。', { key }))
    for (const key of uncited) issues.push(issue('UNCITED', 'info', '条目 ' + key + ' 没有被任何 \\cite 引用。', { key }))
    if (!parsed.complete) issues.push(issue('PARSE_INCOMPLETE', 'error', '.bib 结构不完整，audit 结果可能不完整。'))
    return { ...base, ok: missingInBib.length === 0 && parsed.complete, issues, missingInBib, uncited }
  } catch (error) {
    return { ...base, ok: false, error: { code: 'INTERNAL_ERROR', message: String(error?.message ?? error) } }
  }
}
