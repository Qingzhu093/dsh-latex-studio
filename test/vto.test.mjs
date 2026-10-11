/**
 * T2 acceptance tests: guard / policy / state / render / pdfread / report / vto helpers.
 * Run: node --test test/vto.test.mjs   (from dsh-latex-studio/)
 *
 * Deterministic by design: the render OK path is skipped when a local backend is
 * absent, while the four-safeguard downgrade path is always exercised by
 * injecting an empty PATH and no extra tool dirs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

import { snapshot, verifySnapshot, scanSecrets, hashText, extractProtected } from '../lib/core/guard.js'
import { checkPolicy, FORBIDDEN, scanForbidden, describeViolations } from '../lib/core/policy.js'
import {
  newState,
  nextRound,
  saveState,
  loadState,
  loadStateSafe,
  backupFiles,
  rollback,
  recordRound,
  loadRoundRecord,
  latestRoundRecord,
  resolveWorkDir,
  workPaths,
  SUBDIRS,
} from '../lib/core/state.js'
import { renderPages, parsePages, readPngSize, resolveExecutable, countPdfPages, INSTALL_ADVICE } from '../lib/core/render.js'
import { checkPdfRead, normalizeScope, describeGate } from '../lib/core/pdfread.js'
import { auxFingerprint } from '../lib/core/logparse.js'
import { writeRoundReport, templatePlaceholders, defectProgress, fillTemplate } from '../lib/core/report.js'
import {
  safeRel,
  resolveInside,
  buildChecklist,
  applyEdits,
  normalizeEdits,
  simpleDiff,
  loadTaxonomy,
  collectTexSources,
  inferColumnType,
  findImagePath,
  makeCallReadPdf,
  collectMachineSignals,
  machineSignalLine,
  registerVto,
} from '../lib/tools/vto.js'

const BS = String.fromCharCode(92)
const NL = String.fromCharCode(10)
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vto-test-'))
const tempDir = tmp

/**
 * Minimal 8-bit greyscale PNG writer for a two-column page with a left-column
 * void. Kept local (rather than shared with test/voidetect.test.mjs) because a
 * test fixture that two suites mutate in lockstep would let one suite's needs
 * silently change the other's assertions.
 */
function makeTwoColumnPage(width = 400, height = 400) {
  const raw = Buffer.alloc(height * (width + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0
    for (let x = 0; x < width; x++) {
      const inLeft = x < 190
      const inRight = x > 210
      let value = 255
      if (inLeft && y > 120 && y < 280) value = 255 // planted void
      else if (inLeft || inRight) value = y % 20 < 4 ? 0 : 255
      raw[y * (width + 1) + 1 + x] = value
    }
  }
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  const crc32 = (buf) => {
    let crc = -1
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
    return (crc ^ -1) >>> 0
  }
  const zlibSync = zlib
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const cite = (k) => BS + 'cite{' + k + '}'
const ref = (k) => BS + 'ref{' + k + '}'
const label = (k) => BS + 'label{' + k + '}'
const caption = (t) => BS + 'caption{' + t + '}'

const SOURCE_A = ['引言 ' + cite('smith2020'), '见 ' + ref('fig:one'), label('fig:one'), caption('A figure'), '结果 12.5% 与 3 组实验'].join(String.fromCharCode(10))

// ---------------------------------------------------------------------------
// guard
// ---------------------------------------------------------------------------

test('guard: snapshot + verifySnapshot are stable when nothing changed', () => {
  const snap = snapshot([{ path: 'main.tex', text: SOURCE_A }])
  const result = verifySnapshot(snap, [{ path: 'main.tex', text: SOURCE_A }])
  assert.equal(result.ok, true)
  assert.deepEqual(result.unchanged, ['main.tex'])
  assert.deepEqual(result.changed, [])
  assert.deepEqual(result.added, [])
  assert.deepEqual(result.removed, [])
  assert.deepEqual(result.protectedLost, [])
})

test('guard: deleting any single cite key is intercepted', () => {
  const before = [{ path: 'main.tex', text: 'A ' + cite('alpha') + ' B ' + cite('beta,gamma') + ' C' }]
  const after = [{ path: 'main.tex', text: 'A ' + cite('beta,gamma') + ' C' }]
  const snap = snapshot(before)
  assert.deepEqual(snap.protected.cites, ['alpha', 'beta', 'gamma'])
  const result = verifySnapshot(snap, after)
  assert.equal(result.ok, false, 'removing a cite key must fail the guard')
  assert.ok(result.protectedLost.includes('cite:alpha'))
  assert.deepEqual(result.drift.cites, ['alpha'])
})

test('guard: cite commands with optional args and starred forms are captured', () => {
  const text = BS + 'citep[see][p.3]{key1,key2} ' + BS + 'citet*{key3} ' + BS + 'parencite{key4}'
  const p = extractProtected([{ path: 'x.tex', text }])
  assert.deepEqual(p.cites, ['key1', 'key2', 'key3', 'key4'])
})

test('guard: losing a label/ref/caption blocks; numeric drift only warns', () => {
  const snap = snapshot([{ path: 'main.tex', text: SOURCE_A }])
  const dropped = verifySnapshot(snap, [{ path: 'main.tex', text: '引言 ' + cite('smith2020') + ' 结果 13% 与 3 组实验' }])
  assert.equal(dropped.ok, false)
  assert.ok(dropped.protectedLost.some((p) => p.startsWith('label:')))
  assert.ok(dropped.protectedLost.some((p) => p.startsWith('ref:')))
  assert.ok(dropped.protectedLost.some((p) => p.startsWith('caption:')))

  const numeric = verifySnapshot(snap, [{ path: 'main.tex', text: SOURCE_A.split('12.5%').join('13.0%') }])
  assert.equal(numeric.ok, true, 'numeric drift is advisory, not blocking')
  assert.ok(Object.keys(numeric.drift.numericTokens).length > 0)
  assert.ok(numeric.warnings.some((w) => w.includes('数字 token')))
})

test('guard: removed and added files are reported', () => {
  const snap = snapshot([
    { path: 'main.tex', text: SOURCE_A },
    { path: 'extra.tex', text: 'x' },
  ])
  const result = verifySnapshot(snap, [
    { path: 'main.tex', text: SOURCE_A },
    { path: 'new.tex', text: 'y' },
  ])
  assert.deepEqual(result.removed, ['extra.tex'])
  assert.deepEqual(result.added, ['new.tex'])
  assert.equal(result.ok, false, 'a disappeared source file must fail')
})

test('guard: verifySnapshot without a baseline reports NO_BASELINE and stays ok', () => {
  const result = verifySnapshot(null, [{ path: 'main.tex', text: SOURCE_A }])
  assert.equal(result.ok, true)
  assert.deepEqual(result.added, ['main.tex'])
  assert.ok(result.warnings.some((w) => w.includes('NO_BASELINE')))
})

test('guard: scanSecrets finds and masks common key shapes', () => {
  const text = ['token: sk-abcdefghijklmnopqrstuvwx', 'aws AKIAIOSFODNN7EXAMPLE', 'gh ghp_' + 'a'.repeat(24)].join(String.fromCharCode(10))
  const found = scanSecrets(text)
  const names = found.map((f) => f.pattern)
  assert.ok(names.includes('openai-key'))
  assert.ok(names.includes('aws-access-key-id'))
  assert.ok(names.includes('github-pat'))
  assert.equal(found[0].line, 1)
  assert.ok(found.every((f) => !f.excerpt.includes('sk-abcdefghijklmnopqrstuvwx')), 'secrets must be masked in the excerpt')
})

test('guard: hashText is deterministic', () => {
  assert.equal(hashText('abc'), hashText('abc'))
  assert.notEqual(hashText('abc'), hashText('abd'))
})

// ---------------------------------------------------------------------------
// policy
// ---------------------------------------------------------------------------

test('policy: every forbidden practice is detected as an addition', () => {
  const before = '正文'
  const after = [
    '正文',
    BS + 'resizebox{' + BS + 'textwidth}{!}{x}',
    BS + 'vspace{2em}',
    BS + 'newpage',
    BS + 'tiny z',
    BS + 'scriptsize z',
  ].join(String.fromCharCode(10))
  const result = checkPolicy(before, after)
  const ids = result.violations.map((v) => v.id)
  assert.equal(result.ok, false)
  assert.equal(ids.length, 5)
  for (const rule of FORBIDDEN) assert.ok(ids.includes(rule.id), 'missing rule ' + rule.id)
  assert.equal(result.counts.resizebox.added, 1)
  assert.equal(result.violations.find((v) => v.id === 'bare-vspace').line, 3)
  assert.ok(describeViolations(result.violations).length === 5)
})

test('policy: legacy practice is not re-flagged, new one is', () => {
  const before = 'x ' + BS + 'vspace{1em}' + String.fromCharCode(10) + 'y'
  assert.equal(checkPolicy(before, before).ok, true, 'identical text has no new violations')
  const after = before + String.fromCharCode(10) + BS + 'vspace{3em}'
  const result = checkPolicy(before, after)
  assert.equal(result.counts['bare-vspace'].before, 1)
  assert.equal(result.counts['bare-vspace'].added, 1)
  assert.equal(result.violations.length, 1)
})

test('policy: allowed spacing forms are not flagged', () => {
  const after = BS + 'vspace*{' + BS + 'fill} and ' + BS + 'resizeboxX'
  const result = checkPolicy('', after)
  assert.equal(result.ok, true, 'vspace*{\\fill} is an allowed page-fill form')
})

test('policy: scanForbidden counts every rule', () => {
  const counts = scanForbidden(BS + 'tiny a ' + BS + 'tiny b ' + BS + 'resizebox{x}{y}{z}')
  assert.equal(counts['tiny-font'], 2)
  assert.equal(counts.resizebox, 1)
  assert.equal(counts['bare-vspace'], 0)
})

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

test('state: newState/nextRound are pure and round-trip through disk (spaces + 中文 path)', () => {
  const projectDir = path.join(tmp(), '论文 项目 with space')
  fs.mkdirSync(projectDir, { recursive: true })
  fs.writeFileSync(path.join(projectDir, 'main.tex'), SOURCE_A, 'utf8')

  const workDir = resolveWorkDir(projectDir, '.latex-studio')
  const state = newState({ dir: projectDir, workDir: '.latex-studio', entry: 'main.tex', pageBudget: 9, columnType: 'double' })
  assert.equal(state.round, 0)
  assert.equal(state.pageBudget, 9)

  const advanced = nextRound(state)
  assert.equal(advanced.round, 1)
  assert.equal(state.round, 0, 'nextRound must not mutate its input')
  assert.equal(advanced.history.length, 1)

  saveState(workDir, advanced)
  assert.ok(fs.existsSync(path.join(workDir, 'state.json')))
  const loaded = loadState(workDir)
  assert.equal(loaded.round, 1)
  assert.equal(loaded.dir, path.resolve(projectDir))
  assert.equal(loaded.columnType, 'double')
  for (const sub of SUBDIRS) {
    assert.ok(fs.existsSync(path.join(workDir, sub)), 'missing work subdir ' + sub)
  }
  // The aux dir MUST NOT be named `aux`: that is a reserved DOS device name on
  // Windows and breaks Copy-Item / Explorer / zip tools. The compiler writes to
  // `auxfiles`; creating an empty `aux` here would be a live contradiction.
  assert.ok(SUBDIRS.includes('auxfiles'), 'the compiler aux dir must be auxfiles')
  assert.ok(!SUBDIRS.includes('aux'), 'SUBDIRS must not create a reserved `aux` directory')
})

test('state: newState keeps pageBudget/maxRounds null-safe (Number(null) === 0 trap)', () => {
  assert.equal(newState({ dir: tmp(), pageBudget: null }).pageBudget, null)
  assert.equal(newState({ dir: tmp() }).pageBudget, null)
  assert.equal(newState({ dir: tmp(), pageBudget: '' }).pageBudget, null)
  assert.equal(newState({ dir: tmp(), pageBudget: 0 }).pageBudget, null)
  assert.equal(newState({ dir: tmp(), pageBudget: 9 }).pageBudget, 9)
  assert.equal(newState({ dir: tmp(), pageBudget: '11' }).pageBudget, 11)
  assert.ok(newState({ dir: tmp() }).maxRounds > 0)
})

test('state: loadState is null-safe for a missing or corrupt state.json', () => {
  const workDir = resolveWorkDir(tmp(), '.latex-studio')
  assert.equal(loadState(workDir), null)
  const safe = loadStateSafe(workDir)
  assert.equal(safe.ok, false)
  assert.equal(safe.error, null)

  fs.mkdirSync(workDir, { recursive: true })
  fs.writeFileSync(path.join(workDir, 'state.json'), '{not json', 'utf8')
  assert.equal(loadState(workDir), null)
  assert.ok(loadStateSafe(workDir).error, 'corrupt state reports a reason')
})

test('state: backupFiles then rollback restores the exact bytes', () => {
  const projectDir = path.join(tmp(), 'proj 空格')
  fs.mkdirSync(path.join(projectDir, 'sections'), { recursive: true })
  const rel = path.join('sections', 'method.tex')
  const full = path.join(projectDir, rel)
  fs.writeFileSync(full, SOURCE_A, 'utf8')

  const workDir = resolveWorkDir(projectDir, '.latex-studio')
  const backups = backupFiles(workDir, 1, [rel], { projectRoot: projectDir })
  assert.equal(backups.length, 1)
  assert.equal(fs.readFileSync(backups[0], 'utf8'), SOURCE_A)

  fs.writeFileSync(full, 'BROKEN CONTENT', 'utf8')
  const restored = rollback(workDir, 1)
  assert.equal(restored.length, 1)
  assert.equal(fs.readFileSync(full, 'utf8'), SOURCE_A, 'rollback must restore the original text')
})

test('state: rollback deletes files that did not exist at backup time', () => {
  const projectDir = tmp()
  const workDir = resolveWorkDir(projectDir, '.latex-studio')
  const created = path.join(projectDir, 'appendix.tex')

  const backups = backupFiles(workDir, 2, ['appendix.tex'], { projectRoot: projectDir })
  assert.deepEqual(backups, [], 'nothing to copy for a file that does not exist yet')
  fs.writeFileSync(created, 'new file', 'utf8')

  const affected = rollback(workDir, 2)
  assert.equal(affected.length, 1)
  assert.equal(fs.existsSync(created), false, 'a file created by the fix is removed on rollback')
})

test('state: recordRound writes a JSON sidecar without clobbering the report path', () => {
  const workDir = resolveWorkDir(tmp(), '.latex-studio')
  const file = recordRound(workDir, 3, { action: 'fix', file: 'main.tex', policyAfter: { 'main.tex': SOURCE_A } })
  assert.ok(fs.existsSync(file))
  const record = loadRoundRecord(workDir, 3)
  assert.equal(record.action, 'fix')
  assert.equal(record.round, 3)
  assert.equal(latestRoundRecord(workDir, 5).round, 3)
  assert.equal(latestRoundRecord(workDir, 2), null)
})

test('state: workPaths keeps state/report/backup locations inside the work dir', () => {
  const paths = workPaths(path.join('C:', 'proj', '.latex-studio'))
  assert.ok(paths.state.endsWith('state.json'))
  assert.equal(path.basename(paths.reports), 'reports')
  assert.equal(path.basename(paths.backups), 'backups')
})

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

test('render: parsePages handles all/number/array/range specs', () => {
  assert.deepEqual(parsePages('all', 3), [1, 2, 3])
  assert.deepEqual(parsePages(2, 9), [2])
  assert.deepEqual(parsePages('1-3,5', 9), [1, 2, 3, 5])
  assert.deepEqual(parsePages([4, 1, 1], 9), [1, 4])
  assert.deepEqual(parsePages('all', null), [])
  assert.deepEqual(parsePages('7-2', 9), [2, 3, 4, 5, 6, 7])
  assert.deepEqual(parsePages('99', 9), [], 'out-of-range pages are dropped when the total is known')
})

test('render: readPngSize reads IHDR without an image library', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex')
  const file = path.join(tmp(), 'x.png')
  fs.writeFileSync(file, png)
  assert.deepEqual(readPngSize(file), { width: 1, height: 1 })
  assert.deepEqual(readPngSize(path.join(tmp(), 'missing.png')), { width: null, height: null })
})

test('render: resolveExecutable searches PATH then extra dirs and fails closed', () => {
  assert.equal(resolveExecutable('definitely-not-a-real-tool-xyz', { pathEnv: '', extraDirs: [] }), null)
  const dir = tmp()
  const exe = path.join(dir, 'faketool.EXE')
  fs.writeFileSync(exe, '')
  assert.equal(resolveExecutable('faketool', { pathEnv: dir, extraDirs: [] }), exe)
  assert.equal(resolveExecutable('faketool', { pathEnv: '', extraDirs: [dir] }), exe)
  assert.equal(resolveExecutable('other', { pathEnv: '', extraDirs: [dir] }), null)
})

test('render: missing PDF is skipped with advice, never a throw', async () => {
  const result = await renderPages({ pdfPath: path.join(tmp(), 'nope.pdf') })
  assert.equal(result.status, 'skipped')
  assert.deepEqual(result.pages, [])
  assert.ok(result.reason.includes('不存在'))
  assert.ok(result.advice)
})

test('render: no pdfPath at all is skipped', async () => {
  const result = await renderPages({})
  assert.equal(result.status, 'skipped')
  assert.ok(result.reason.includes('pdfPath'))
})

test('render: safeguard 4 — all backends missing yields skipped + advice + downgrade flag', async () => {
  const pdf = path.join(tmp(), 'fake.pdf')
  fs.writeFileSync(pdf, '%PDF-1.4 not really a pdf', 'utf8')
  const result = await renderPages({
    pdfPath: pdf,
    pages: 1,
    outDir: path.join(tmp(), 'pages'),
    config: { rendererOrder: ['poppler', 'miktex-ghostscript', 'mineru-page'] },
    pathEnv: '',
    extraDirs: [],
  })
  assert.equal(result.status, 'skipped')
  assert.equal(result.rendererDowngrade, true)
  assert.equal(result.backend, null)
  assert.ok(result.reason.includes('poppler'))
  assert.ok(result.reason.includes('miktex-ghostscript'))
  assert.ok(result.reason.includes('mineru-page'))
  assert.ok(result.advice.includes('mgs.exe'))
  assert.equal(result.attempts.length, 3)
  assert.ok(result.attempts.every((a) => a.available === false))
})

test('render: mineru-page without an injected bridge is reported as unavailable', async () => {
  const pdf = path.join(tmp(), 'fake2.pdf')
  fs.writeFileSync(pdf, '%PDF-1.4', 'utf8')
  const result = await renderPages({
    pdfPath: pdf,
    pages: 1,
    outDir: path.join(tmp(), 'pages2'),
    config: { rendererOrder: ['mineru-page'] },
    pathEnv: '',
    extraDirs: [],
  })
  assert.equal(result.status, 'skipped')
  assert.equal(result.attempts[0].backend, 'mineru-page')
  assert.ok(result.attempts[0].reason.includes('callReadPdf'))
})

test('render: an injected bridge that returns an image path is used as backend mineru-page', async () => {
  const dir = tmp()
  const pdf = path.join(dir, 'doc.pdf')
  fs.writeFileSync(pdf, '%PDF-1.4', 'utf8')
  const png = path.join(dir, 'from-bridge.png')
  fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex'))

  const result = await renderPages({
    pdfPath: pdf,
    pages: 1,
    outDir: path.join(dir, 'pages'),
    config: { rendererOrder: ['mineru-page'] },
    pathEnv: '',
    extraDirs: [],
    callReadPdf: async ({ page }) => ({ path: png, page }),
  })
  assert.equal(result.status, 'ok')
  assert.equal(result.backend, 'mineru-page')
  assert.equal(result.pages.length, 1)
  assert.equal(result.pages[0].index, 1)
  assert.deepEqual([result.pages[0].width, result.pages[0].height], [1, 1])
})

test('render: a bridge returning an attachment keeps it on the page record', async () => {
  const dir = tmp()
  const pdf = path.join(dir, 'doc2.pdf')
  fs.writeFileSync(pdf, '%PDF-1.4', 'utf8')
  const attachment = { id: 'att-1', mediaType: 'image/png' }
  const result = await renderPages({
    pdfPath: pdf,
    pages: 1,
    outDir: path.join(dir, 'pages3'),
    config: { rendererOrder: ['mineru-page'] },
    pathEnv: '',
    extraDirs: [],
    callReadPdf: async () => ({ attachment, width: 800, height: 1000 }),
  })
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.pages[0].attachment, attachment)
})

/**
 * Backend availability must consult the plugin's own resolver, not bare PATH:
 * this machine keeps `pdftoppm.exe` / `mgs.exe` inside D:\MiKTeX\miktex\bin\x64,
 * which the DSH process PATH does not contain. lib/core/env.js owns that search.
 * @param {string} name - executable base name.
 * @returns {Promise<string|null>} absolute path, or null when genuinely absent.
 */
async function backendPath(name) {
  try {
    const env = await import('../lib/core/env.js')
    if (typeof env.resolveTool === 'function') {
      const found = env.resolveTool(name)
      if (found) return found
    }
  } catch {
    /* env.js unavailable: fall back to the render resolver */
  }
  return resolveExecutable(name, { pathEnv: process.env.PATH })
}

let samplePdfPromise = null

/**
 * Self-build a minimal sample PDF so the backend tests never depend on a stale
 * repository artifact (latex-demo/main.pdf now lives under .latex-studio/build/).
 * @returns {Promise<{pdfPath?: string, skip?: string}>} built PDF or a skip reason.
 */
function samplePdf() {
  if (samplePdfPromise) return samplePdfPromise
  samplePdfPromise = (async () => {
    const project = tmp()
    fs.writeFileSync(
      path.join(project, 'main.tex'),
      [BS + 'documentclass{article}', BS + 'begin{document}', 'VTO sample page.', BS + 'end{document}', ''].join(String.fromCharCode(10)),
      'utf8'
    )
    try {
      const compile = await import('../lib/core/compile.js')
      if (typeof compile.build !== 'function') return { skip: 'no sample PDF: lib/core/compile.js exposes no build()' }
      const built = await compile.build({ dir: project, entry: 'main.tex', engine: 'auto', config: {} })
      if (built && built.pdfPath && fs.existsSync(built.pdfPath)) return { pdfPath: built.pdfPath }
      return { skip: 'no sample PDF: latex engine unavailable or compile failed (' + String((built && (built.reason || built.status)) || 'unknown') + ')' }
    } catch (error) {
      return { skip: 'no sample PDF: ' + String((error && error.message) || error) }
    }
  })()
  return samplePdfPromise
}

test('render: local poppler backend end-to-end', async (t) => {
  const exe = await backendPath('pdftoppm')
  if (!exe) {
    t.skip('pdftoppm not found (checked PATH and the MiKTeX bin dirs)')
    return
  }
  const sample = await samplePdf()
  if (!sample.pdfPath) {
    t.skip(sample.skip)
    return
  }
  const outDir = path.join(tmp(), 'poppler-pages')
  const result = await renderPages({ pdfPath: sample.pdfPath, pages: 1, dpi: 72, outDir, config: { rendererOrder: ['poppler'] } })
  assert.equal(result.status, 'ok')
  assert.equal(result.backend, 'poppler')
  assert.equal(result.pages.length, 1)
  assert.ok(result.pages[0].bytes > 1000)
  assert.ok(result.pages[0].width > 0 && result.pages[0].height > 0)
})

test('vto: resolveInside handles forward-slash roots and trailing separators (PATH_ESCAPE regression)', () => {
  for (const root of ['/', 'C:/', 'C:' + BS, 'D:/proj/', 'D:' + BS + 'proj', '/tmp/proj']) {
    const result = resolveInside(root, 'main.tex')
    assert.equal(result.inside, true, 'root ' + JSON.stringify(root) + ' must contain main.tex')
    assert.equal(path.isAbsolute(result.abs), true)
  }
  assert.equal(resolveInside('c:/users/x', 'a.tex').inside, true, 'drive-letter case must not defeat containment')
  assert.equal(resolveInside('/tmp/proj', 'a/b/c.tex').inside, true)
  assert.equal(resolveInside('/tmp/proj', '../escape.tex').inside, false, 'escape still rejected')
  assert.equal(resolveInside('D:/proj', '..' + BS + 'x.tex').inside, false)
})
test('vto: safeRel throws PathError so tool output can report INVALID_PATH', () => {
  try {
    safeRel('C:/x.tex', 'file')
    assert.fail('should have thrown')
  } catch (error) {
    assert.equal(error.name, 'PathError')
  }
})

test('render: local MiKTeX Ghostscript backend end-to-end', async (t) => {
  const exe = await backendPath('mgs')
  if (!exe) {
    t.skip('mgs.exe not found (checked PATH and the MiKTeX bin dirs)')
    return
  }
  const sample = await samplePdf()
  if (!sample.pdfPath) {
    t.skip(sample.skip)
    return
  }
  const outDir = path.join(tmp(), 'gs-pages')
  const result = await renderPages({ pdfPath: sample.pdfPath, pages: 1, dpi: 72, outDir, config: { rendererOrder: ['miktex-ghostscript'] } })
  assert.equal(result.status, 'ok')
  assert.equal(result.backend, 'miktex-ghostscript')
  assert.equal(result.pages.length, 1)
  assert.ok(result.pages[0].bytes > 1000)
  assert.ok(result.pages[0].width > 0 && result.pages[0].height > 0)
})

test('render: INSTALL_ADVICE covers every backend', () => {
  for (const backend of ['poppler', 'miktex-ghostscript', 'mineru-page']) {
    assert.equal(typeof INSTALL_ADVICE[backend], 'string')
    assert.ok(INSTALL_ADVICE[backend].length > 10)
  }
})

// ---------------------------------------------------------------------------
// pdfread gate
// ---------------------------------------------------------------------------

test('pdfread: external-only blocks the user manuscript but always allows local page view', () => {
  const config = { uploadScope: 'external-only' }
  const blocked = checkPdfRead(config, { view: 'content', isUserWork: true })
  assert.equal(blocked.allowed, false)
  assert.ok(blocked.reason.includes('手稿'))
  assert.ok(blocked.advice)

  const local = checkPdfRead(config, { view: 'page', isUserWork: true })
  assert.equal(local.allowed, true)
  assert.equal(local.uploads, false)

  assert.equal(checkPdfRead(config, { view: 'content', isUserWork: false }).allowed, true)
  assert.equal(checkPdfRead(config, { view: 'content', isUserWork: true, consent: true }).allowed, true)
})

test('pdfread: never blocks parsing, always allows it', () => {
  assert.equal(checkPdfRead({ uploadScope: 'never' }, { view: 'content' }).allowed, false)
  assert.equal(checkPdfRead({ uploadScope: 'never' }, { view: 'page' }).allowed, true)
  assert.equal(checkPdfRead({ uploadScope: 'always' }, { view: 'content' }).allowed, true)
})

test('pdfread: unknown scope falls back to external-only and describeGate explains', () => {
  assert.equal(normalizeScope({ uploadScope: 'bogus' }), 'external-only')
  assert.equal(normalizeScope({}), 'external-only')
  const text = describeGate(checkPdfRead({ uploadScope: 'never' }, { view: 'content' }))
  assert.ok(text.startsWith('拒绝'))
})

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

test('report: writeRoundReport fills the vendored template with no unresolved placeholders', () => {
  const workDir = resolveWorkDir(tmp(), '.latex-studio')
  const written = writeRoundReport(workDir, 1, {
    verdict: 'CONTINUE',
    compile: { compileSuccess: true, pages: 9, errors: [{ message: 'e' }], warnings: [{ message: 'w' }] },
    defectsBefore: { A1: 2, A5: 1, B1: 1 },
    defectsAfter: { A1: 1 },
    changes: ['调整浮动体位置'],
    gate: [{ name: 'compile', ok: true, detail: 'passed' }],
    conclusion: 'CONTINUE',
  })
  assert.ok(fs.existsSync(written.mdPath))
  assert.ok(fs.existsSync(written.jsonPath))
  const markdown = fs.readFileSync(written.mdPath, 'utf8')
  assert.deepEqual(templatePlaceholders(markdown), [])
  assert.ok(markdown.includes('第 1 轮'))
  assert.ok(markdown.includes('调整浮动体位置'))
  const sidecar = JSON.parse(fs.readFileSync(written.jsonPath, 'utf8'))
  assert.deepEqual(sidecar.unresolvedPlaceholders, [])
  assert.equal(sidecar.round, 1)
})

test('report: defectProgress aggregates by category with percentages', () => {
  const progress = defectProgress({ defectsBefore: { A1: 2, A2: 2, B1: 1, D1: 1 }, defectsAfter: { A1: 1, B1: 1 } })
  assert.equal(progress.totals.init, 6)
  assert.equal(progress.totals.remaining, 2)
  assert.equal(progress.rows[0][3], '75%')
  assert.equal(progress.rows[5][2], 2)
})

test('report: fillTemplate leaves unresolved keys as the fallback dash', () => {
  assert.equal(fillTemplate('a {{KNOWN}} b {{MISSING}}', { KNOWN: 'x' }), 'a x b —')
})

// ---------------------------------------------------------------------------
// vto.js pure helpers
// ---------------------------------------------------------------------------

test('vto: safeRel rejects absolute paths, drive letters and ..', () => {
  assert.equal(safeRel('sections/method.tex', 'file'), path.normalize('sections/method.tex'))
  for (const bad of ['C:' + BS + 'x' + BS + 'y.tex', '/abs/y.tex', '../y.tex', 'a/../../b.tex', BS + BS + 'server' + BS + 'share' + BS + 'x.tex', '']) {
    assert.throws(() => safeRel(bad, 'file'), /file/, 'should reject: ' + JSON.stringify(bad))
  }
})

test('vto: checklist exposes all 18 taxonomy ids and hides two-column-only items for single column', () => {
  const taxonomy = loadTaxonomy()
  assert.equal((taxonomy.defects || []).length, 18)
  const double = buildChecklist({ columnType: 'double' })
  assert.equal(double.length, 18)
  assert.deepEqual(double.map((d) => d.id), ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3', 'E1', 'E2', 'E3'])
  const single = buildChecklist({ columnType: 'single' })
  assert.equal(single.length, 16)
  assert.ok(!single.some((d) => d.id === 'A4' || d.id === 'A5'))
  assert.deepEqual(buildChecklist({ columnType: 'double', focus: 'A5,B1' }).map((d) => d.id), ['A5', 'B1'])
  assert.deepEqual(buildChecklist({ columnType: 'double', focus: 'D' }).map((d) => d.id), ['D1', 'D2', 'D3'])
  const item = double[0]
  assert.equal(typeof item.what, 'string')
  assert.ok(item.what.length > 10)
  assert.ok(Array.isArray(item.allowed))
  assert.ok(item.forbidden.includes('resizebox'))
})

test('vto: applyEdits is exact, refuses ambiguous matches and supports replaceAll', () => {
  const one = applyEdits('a' + String.fromCharCode(10) + 'b' + String.fromCharCode(10) + 'c', [{ find: 'b', replace: 'B' }])
  assert.equal(one.ok, true)
  assert.equal(one.text, 'a' + String.fromCharCode(10) + 'B' + String.fromCharCode(10) + 'c')
  assert.equal(applyEdits('abc', [{ find: 'zz', replace: 'y' }]).code, 'EDIT_NOT_FOUND')
  assert.equal(applyEdits('x x', [{ find: 'x', replace: 'y' }]).code, 'EDIT_AMBIGUOUS')
  const all = applyEdits('x x', [{ find: 'x', replace: 'y', replaceAll: true }])
  assert.equal(all.ok, true)
  assert.equal(all.text, 'y y')
  assert.deepEqual(normalizeEdits({ find: 'a', replace: 'b' }), [{ find: 'a', replace: 'b', replaceAll: false }])
  assert.deepEqual(normalizeEdits({}), [])
})

test('vto: simpleDiff trims the common prefix and suffix', () => {
  const diff = simpleDiff('p' + String.fromCharCode(10) + 'q' + String.fromCharCode(10) + 'r', 'p' + String.fromCharCode(10) + 'Q' + String.fromCharCode(10) + 'r')
  assert.ok(diff.includes('- q'))
  assert.ok(diff.includes('+ Q'))
  assert.ok(!diff.includes('- p'))
})

test('vto: collectTexSources/inferColumnType read a real project layout', () => {
  const projectDir = tmp()
  fs.mkdirSync(path.join(projectDir, 'sections'), { recursive: true })
  fs.mkdirSync(path.join(projectDir, '.latex-studio'), { recursive: true })
  fs.writeFileSync(path.join(projectDir, 'main.tex'), BS + 'documentclass[twocolumn]{article}', 'utf8')
  fs.writeFileSync(path.join(projectDir, 'sections', 'method.tex'), 'text', 'utf8')
  fs.writeFileSync(path.join(projectDir, '.latex-studio', 'ignored.tex'), 'skip me', 'utf8')
  const sources = collectTexSources(projectDir)
  assert.deepEqual(sources.map((s) => s.path.split(BS).join('/')).sort(), ['main.tex', 'sections/method.tex'])
  assert.equal(inferColumnType(sources), 'double')
  assert.equal(inferColumnType([{ path: 'a.tex', text: 'plain' }]), 'single')
})

test('vto: findImagePath and makeCallReadPdf degrade without a harness', async () => {
  assert.equal(findImagePath({ ordered_images: [{ path: '/tmp/a.png' }] }), '/tmp/a.png')
  assert.equal(findImagePath({ files: [{ artifacts: [{ path: '/x/y.jpg' }] }] }), '/x/y.jpg')
  assert.equal(findImagePath({}), null)
  const bridge = makeCallReadPdf({}, { readPdfToolName: 'read_pdf' })
  assert.equal(await bridge({ pdfPath: '/tmp/x.pdf', page: 1 }), null)
})
// ---------------------------------------------------------------------------
// harness-gated integration (runs only where @deepseek-ai/dsh-tools is installed)
// ---------------------------------------------------------------------------

/** Load the real defineTool, or null when the peer dependency is absent. */
async function loadDshTools() {
  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    return typeof mod.defineTool === 'function' ? mod : null
  } catch {
    return null
  }
}

/** Build a project fixture with a real LaTeX document and, when buildable, a real PDF. */
async function fixtureProject() {
  const project = tmp()
  const cite = BS + 'cite{smith2020}'
  const source = [
    BS + 'documentclass[11pt]{article}',
    BS + 'begin{document}',
    'Intro ' + cite + ' and ' + BS + 'ref{tab:one}.',
    BS + 'begin{table}', BS + 'centering',
    BS + 'begin{tabular}{ll}', 'a & b' + BS + BS, BS + 'end{tabular}',
    BS + 'caption{One}', BS + 'label{tab:one}', BS + 'end{table}',
    BS + 'end{document}',
  ].join(String.fromCharCode(10))
  fs.writeFileSync(path.join(project, 'main.tex'), source, 'utf8')
  const sample = await samplePdf()
  if (sample.pdfPath) fs.copyFileSync(sample.pdfPath, path.join(project, 'main.pdf'))
  return { project, source }
}

test('vto: registerVto registers the five tools with the real defineTool (auto-skips without the peer dep)', async (t) => {
  if (!(await loadDshTools())) {
    t.skip('@deepseek-ai/dsh-tools is not resolvable from this workspace')
    return
  }
  const defs = []
  const ctx = { tools: { register: (d) => defs.push(d) }, get: () => undefined }
  const result = registerVto(ctx, { uploadScope: 'external-only' })
  assert.deepEqual(result.registered, ['vto_start', 'vto_inspect', 'vto_fix', 'vto_verify', 'vto_report'])
  assert.equal(defs.length, 5)
  for (const definition of defs) {
    assert.equal(typeof definition.execute, 'function')
    assert.equal(definition.parameters.type, 'object')
    assert.equal(definition.output.schema.type, 'object')
    assert.equal(typeof definition.output.render, 'function')
  }
})

test('vto: registerVto fails loudly without a tools service', () => {
  assert.throws(() => registerVto({}, {}), /ctx\.tools|dsh-tools/)
})

test('vto: full loop through the real tools (auto-skips without the peer dep)', async (t) => {
  if (!(await loadDshTools())) {
    t.skip('@deepseek-ai/dsh-tools is not resolvable from this workspace')
    return
  }
  const { project } = await fixtureProject()
  const defs = []
  const ctx = { tools: { register: (d) => defs.push(d) }, get: () => undefined }
  registerVto(ctx, { uploadScope: 'external-only', pageBudget: null })
  const exec = { agent: { session: { header: { cwd: project } } }, signal: new AbortController().signal }
  const byName = Object.fromEntries(defs.map((d) => [d.name, d]))
  const call = (name, args) => byName[name].execute(args, exec)

  const start = await call('vto_start', {})
  assert.equal(start.ok, true)
  assert.equal(start.entry, 'main.tex')
  assert.equal(start.baseline.cites, 1)
  assert.ok(fs.existsSync(path.join(project, '.latex-studio', 'state.json')))

  const inspect = await call('vto_inspect', { pages: '1', dpi: 72 })
  assert.ok(['ok', 'skipped', 'failed'].includes(inspect.status))
  assert.equal(inspect.checklist.length, 16, 'single-column checklist excludes A4/A5')
  assert.equal(inspect.gate.allowed, true, 'local page view is always allowed')
  assert.ok(Array.isArray(byName.vto_inspect.output.render({}, inspect)))

  const dry = await call('vto_fix', { file: 'main.tex', find: 'Intro ', replace: 'Introduction ' })
  assert.equal(dry.ok, true)
  assert.equal(dry.applied, false)
  assert.ok(dry.diff.includes('+ Introduction'))
  assert.ok(fs.readFileSync(path.join(project, 'main.tex'), 'utf8').includes('Intro '))

  const forbidden = await call('vto_fix', { file: 'main.tex', find: 'Intro ', replace: BS + 'resizebox{x}{y}{Intro }', apply: true })
  assert.equal(forbidden.ok, false)
  assert.equal(forbidden.error.code, 'BLOCKED_BY_GUARD')
  assert.ok(!fs.readFileSync(path.join(project, 'main.tex'), 'utf8').includes('resizebox'))

  const applied = await call('vto_fix', { file: 'main.tex', find: 'Intro ', replace: 'Introduction ', apply: true, round: 1 })
  assert.equal(applied.applied, true)
  assert.equal(applied.backups.length, 1)
  assert.ok(fs.readFileSync(path.join(project, 'main.tex'), 'utf8').includes('Introduction '))

  const destructive = await call('vto_fix', {
    file: 'main.tex',
    find: BS + 'cite{smith2020}',
    replace: '',
    apply: true,
    force: true,
    round: 2,
  })
  assert.equal(destructive.applied, false)
  assert.equal(destructive.rolledBack, true)
  assert.equal(destructive.error.code, 'ROLLED_BACK')
  assert.ok(destructive.contentIntegrity.protectedLost.includes('cite:smith2020'))
  assert.ok(fs.readFileSync(path.join(project, 'main.tex'), 'utf8').includes(BS + 'cite{smith2020}'))

  const report = await call('vto_report', { verdict: 'pass', changes: ['wording'], defectsAfter: { A1: 0 } })
  assert.equal(report.ok, true)
  const markdown = fs.readFileSync(path.join(project, report.mdPath), 'utf8')
  assert.deepEqual(templatePlaceholders(markdown), [])

  const escaped = await call('vto_fix', { file: 'C:/windows/system32/drivers/etc/hosts', find: 'a', replace: 'b' })
  assert.equal(escaped.ok, false)
  assert.equal(escaped.error.code, 'INVALID_PATH')

  const traversal = await call('vto_fix', { file: '../outside.tex', find: 'a', replace: 'b' })
  assert.equal(traversal.ok, false)
  assert.equal(traversal.error.code, 'INVALID_PATH')

  // refuse() envelope regression: every early return carries the same keys. The
  // EDIT_NOT_FOUND path once omitted `rolledBack`, which read as `undefined`.
  const notFound = await call('vto_fix', { file: 'main.tex', find: 'THIS TEXT DOES NOT EXIST', replace: 'x', apply: true })
  assert.equal(notFound.ok, false)
  assert.equal(notFound.error.code, 'EDIT_NOT_FOUND')
  for (const key of ['ok', 'applied', 'file', 'rolledBack', 'backups', 'violations', 'contentIntegrity', 'secrets', 'diff', 'error', 'advice']) {
    assert.ok(Object.hasOwn(notFound, key), 'early-return envelope is missing ' + key)
  }
  assert.equal(notFound.rolledBack, false)
  assert.equal(notFound.applied, false)
})

// --- regressions found by the review ---------------------------------------

test('vto: buildChecklist exposes numeric thresholds from layout_rules.json', () => {
  // PaperFit keeps the bars in config/layout_rules.yaml, and its detective agent
  // reads them from there. Previously the DSH port shipped `thresholds: null`
  // for most defects, so the model was told WHAT to look for but never HOW MUCH
  // counts as a defect.
  const rules = JSON.parse(fs.readFileSync(new URL('../lib/data/layout_rules.json', import.meta.url), 'utf8'))
  const double = buildChecklist({ columnType: 'double' })
  const a5 = double.find((item) => item.id === 'A5')
  assert.ok(a5, 'A5 is a two-column defect and must appear for double layouts')
  assert.equal(a5.layoutRules['intra_column_void.min_void_ratio_of_column'], rules.intra_column_void.min_void_ratio_of_column)
  assert.equal(a5.layoutRules['intra_column_void.min_void_height_lines'], rules.intra_column_void.min_void_height_lines)

  const single = buildChecklist({ columnType: 'single' })
  assert.equal(single.find((item) => item.id === 'A5'), undefined, 'A5 must not appear for single-column layouts')
  const a2 = single.find((item) => item.id === 'A2')
  assert.equal(a2.layoutRules['whitespace.trailing_whitespace_max_ratio'], rules.whitespace.trailing_whitespace_max_ratio)
  const b1 = single.find((item) => item.id === 'B1')
  assert.equal(b1.layoutRules['float.max_reference_distance_pages'], rules.float.max_reference_distance_pages)
  const d1 = single.find((item) => item.id === 'D1')
  assert.equal(d1.layoutRules['equation.overflow_severity_threshold_pt'], rules.equation.overflow_severity_threshold_pt)
  // Every defect must carry at least one usable number somewhere (inline
  // threshold or layout rule), otherwise the checklist is not actionable.
  for (const item of single) {
    const hasNumbers = Object.keys(item.layoutRules).length > 0 || item.thresholds !== null || Boolean(item.metric && item.metric.target !== undefined)
    assert.ok(hasNumbers, item.id + ' carries no numeric bar at all')
  }
})

test('vto: collectMachineSignals reads rendered pages and abstains for single column', () => {
  const project = tempDir('dsh-signals-')
  try {
    // A two-column synthetic page with a deliberate left-column void.
    const png = makeTwoColumnPage()
    const pagePath = path.join(project, 'page-001.png')
    fs.writeFileSync(pagePath, png)

    const double = collectMachineSignals([{ index: 1, path: pagePath }], { columnType: 'double' })
    assert.equal(double.available, true)
    assert.equal(double.pages.length, 1)
    assert.equal(double.pages[0].layout, 'double')
    assert.ok(double.pages[0].a5_candidates.length >= 1, 'the planted void must be detected')
    assert.deepEqual(double.a5CandidatePages, [1])
    assert.equal(double.byDefect.A5.detector, 'detect_column_void')
    assert.ok(double.byDefect.A5.candidates >= 1)
    // Page-level metrics must be present regardless of layout.
    assert.ok(double.pages[0].inkRatio > 0)
    assert.ok(double.pages[0].contentBox)

    const single = collectMachineSignals([{ index: 1, path: pagePath }], { columnType: 'single' })
    assert.deepEqual(single.a5CandidatePages, [], 'single column must not raise A5')
    assert.equal(single.pages[0].layout, 'single')
    assert.deepEqual(single.pages[0].a5_candidates, [])

    // Missing page image degrades per page instead of throwing.
    const missing = collectMachineSignals([{ index: 9, path: path.join(project, 'nope.png') }], { columnType: 'double' })
    assert.equal(missing.pages[0].ok, false)
    assert.match(missing.pages[0].reason, /READ_FAILED/)

    // No pages at all is reported, not assumed clean.
    const none = collectMachineSignals([], { columnType: 'double' })
    assert.equal(none.available, false)
    assert.ok(none.reason)
  } finally {
    fs.rmSync(project, { recursive: true, force: true })
  }
})

test('vto: machineSignalLine states candidates without asserting a defect', () => {
  assert.equal(machineSignalLine(undefined), null)
  assert.match(machineSignalLine({ available: false, reason: '没有页图可供机检' }), /跳过/)
  assert.match(machineSignalLine({ available: true, pages: [{ ok: true, a5_candidates: [] }] }), /无 A5 列空洞候选/)
  const withCandidate = machineSignalLine({
    available: true,
    pages: [{ index: 4, ok: true, a5_candidates: [{ column: 'left', void_ratio_of_column: 0.42 }] }],
  })
  assert.match(withCandidate, /A5 候选 1 处/)
  assert.match(withCandidate, /第 4 页 left 42%/)
  assert.doesNotMatch(withCandidate, /缺陷/, 'the line must not claim a defect exists')
})


test('vto: applyEdits inserts replacements LITERALLY ($ in LaTeX math must survive)', () => {
  // `String.replace(str, str)` expands $&, $`, $', $1 and $$ in the replacement.
  // LaTeX is full of `$`, so a repair such as `$O(n^2)$` used to be rewritten.
  const doc = [BS + '[', ' x = 1', BS + ']', ''].join(NL)
  const cases = [
    ['$&$&', '$&$&'],
    ['$`', '$`'],
    ['$$', '$$'],
    ["$'", "$'"],
    ['x$1y', 'x$1y'],
    ['a$&b', 'a$&b'],
    ['$O(n^2)$', '$O(n^2)$'],
  ]
  for (const [replacement, expected] of cases) {
    const single = applyEdits(doc, [{ find: 'x = 1', replace: replacement }])
    assert.equal(single.ok, true)
    assert.ok(single.text.includes(expected), 'literal replacement lost: ' + JSON.stringify(replacement) + ' -> ' + JSON.stringify(single.text))
    assert.ok(!single.text.includes('x = 1'), 'the find text must be gone')

    // Both branches must agree: replaceAll:true changes scope, not semantics.
    const all = applyEdits(doc, [{ find: 'x = 1', replace: replacement, replaceAll: true }])
    assert.equal(all.text, single.text, 'replaceAll changed the semantics of the replacement')
  }
})

test('vto: workDir cannot escape the project (absolute / .. are refused, never written to)', () => {
  const project = tempDir('dsh-workdir-')
  const outside = tempDir('dsh-outside-')
  try {
    const hostile = [
      outside,                              // absolute
      'C:' + BS + 'Windows' + BS + 'Temp',  // drive-absolute
      '\\\\server\\share',                  // UNC
      '//server/share',                     // UNC, posix spelling
      '..' + BS + 'sibling',                // parent escape
      'a/../../b',                          // nested escape
      '',                                   // empty -> default
    ]
    for (const name of hostile) {
      const resolved = resolveWorkDir(project, name)
      const rel = path.relative(project, resolved)
      assert.ok(
        resolved === path.resolve(project, '.latex-studio') || (!rel.startsWith('..') && !path.isAbsolute(rel)),
        'workDir escaped the project: ' + JSON.stringify(name) + ' -> ' + resolved,
      )
    }
    // A legitimate nested name still works.
    assert.equal(resolveWorkDir(project, '.latex-studio'), path.resolve(project, '.latex-studio'))
    assert.equal(resolveWorkDir(project, 'out/vto'), path.resolve(project, 'out', 'vto'))
  } finally {
    fs.rmSync(project, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('state: an empty/missing .aux is NOT treated as convergence (multi-pass build)', () => {
  // The pass loop used to break as soon as two consecutive .aux fingerprints
  // matched, and the fingerprint of a missing/empty .aux is ''. A document whose
  // first pass produced no \\newlabel therefore stopped early and was reported
  // `passed` with unresolved cross-references. `auxFingerprint('')` is
  // deliberately the marker that must never count as "stable".
  const empty = auxFingerprint('')
  assert.equal(empty === '', true, 'empty aux must still fingerprint to the empty marker')
  const populated = auxFingerprint([BS + 'newlabel{eq:main}{{1}{1}}', BS + 'newlabel{tab:x}{{2}{3}}'].join(NL))
  assert.notEqual(populated, '', 'a populated .aux must fingerprint to something non-empty')
  assert.notEqual(populated, empty)
})

