/**
 * T1 (A-line) test suite: env / logparse / compile / lint / bib / daily tools.
 *
 * Run from the plugin directory:  node --test test/daily.test.mjs
 *
 * Self-contained by design: every fixture (LaTeX project, .bib files, PDF) is
 * written into a fresh temp directory by this file. Nothing here depends on
 * generated artifacts inside `latex-demo` (build outputs, logs, PDFs), so
 * cleaning that demo can never turn this suite red.
 *
 * The tools layer is exercised through a `node:module` resolve hook that maps
 * `@deepseek-ai/dsh-tools` onto a faithful stub of the documented value-schema
 * DSL, so this file runs even without the peer dependency installed.
 *
 * KNOWN BLIND SPOT, stated plainly: because that hook is file-scoped and also
 * serves `createRequire`, this file CANNOT validate the shipped definitions
 * against the real `defineTool` — an attempt to do so silently resolves the stub
 * too. Real-`defineTool` coverage of the B line lives in
 * `test/vto.test.mjs` ("registers the five tools with the real defineTool"), and
 * the A line is covered end-to-end by the live host (the tools are registered and
 * callable in `cordis_inspect_query` -> `Tool.listTools`). Do not add a
 * real-module assertion here expecting it to bypass the hook.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerHooks } from 'node:module'

import { probeEnv, resolveTool } from '../lib/core/env.js'
import { parseLatexLog } from '../lib/core/logparse.js'
import { build } from '../lib/core/compile.js'
import { extractProtected, lintProject } from '../lib/core/lint.js'
import { bibAction, parseBib } from '../lib/core/bib.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = resolve(HERE, '..')
const WORKSPACE = resolve(PLUGIN, '..')
const BS = String.fromCharCode(92)
const BQ = String.fromCharCode(96)
const NL = String.fromCharCode(10)
const T = BS

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix))
}

// --- self-contained fixtures ------------------------------------------------
const FIXTURE_TEX = [
  T + 'documentclass[11pt]{article}',
  T + 'usepackage[T1]{fontenc}',
  T + 'usepackage{booktabs}',
  T + 'usepackage{amsmath}',
  T + 'usepackage[numbers]{natbib}',
  '',
  T + 'title{A Minimal LaTeX Smoke Test}',
  T + 'author{DSH verification}',
  T + 'date{' + T + 'today}',
  '',
  T + 'begin{document}',
  T + 'maketitle',
  '',
  T + 'begin{abstract}',
  'This project exists to prove that a real TeX engine can compile it end to end,',
  'and that the bib tools can audit it.',
  T + 'end{abstract}',
  '',
  T + 'section{Introduction}',
  'Typesetting quality matters ' + T + 'citep{knuth1984texbook, vaswani2017attention}.',
  'A compile-and-fix loop is what makes an agent reliable on LaTeX.',
  '',
  T + 'section{Method}',
  T + 'begin{equation}',
  '  ' + T + 'label{eq:main}',
  '  ' + T + 'mathcal{L}(' + T + 'theta) = ' + T + 'sum_{i=1}^{N} ' + T + 'left( y_i - f_' + T + 'theta(x_i) ' + T + 'right)^2 .',
  T + 'end{equation}',
  '',
  T + 'begin{table}[t]',
  '  ' + T + 'centering',
  '  ' + T + 'caption{Compile success rate by task difficulty.}',
  '  ' + T + 'label{tab:rates}',
  '  ' + T + 'begin{tabular}{lcc}',
  '    ' + T + 'toprule',
  '    Model & Easy & Hard ' + T + T,
  '    ' + T + 'midrule',
  '    baseline & 0.71 & 0.32 ' + T + T,
  '    with compile loop & 0.98 & 0.86 ' + T + T,
  '    ' + T + 'bottomrule',
  '  ' + T + 'end{tabular}',
  T + 'end{table}',
  '',
  T + 'bibliographystyle{plainnat}',
  T + 'bibliography{refs}',
  '',
  T + 'end{document}',
  '',
].join(NL)

const FIXTURE_BIB = [
  '@book{knuth1984texbook,',
  '  author    = {Knuth, Donald E.},',
  '  title     = {The {' + T + 'TeX}book},',
  '  year      = {1984},',
  '  publisher = {Addison-Wesley}',
  '}',
  '',
  '@article{vaswani2017attention,',
  '  author  = {Vaswani, Ashish and Shazeer, Noam},',
  '  title   = {Attention Is All You Need},',
  '  journal = {NeurIPS},',
  '  year    = {2017}',
  '}',
  '',
  '@article{li2024unused,',
  '  author  = {Li, Someone},',
  '  title   = {An Entry That Is Never Cited},',
  '  journal = {Journal of Unused References},',
  '  year    = {2024}',
  '}',
  '',
].join(NL)

/** Same shape as FIXTURE_BIB but with the first entry left unclosed. */
const BROKEN_BIB = [
  '@article{brokenentry2020,',
  '  author  = {Broken, Entry},',
  '  title   = {An entry whose closing brace is missing}',
  '  year    = {2020}',
  '',
  '@article{li2024unused,',
  '  author = {Li, Someone},',
  '  title  = {An Entry That Is Never Cited},',
  '  year   = {2024}',
  '}',
  '',
].join(NL)

/** Minimal one-page PDF; Poppler/MiKTeX render it without a TeX engine. */
const MINIMAL_PDF = [
  '%PDF-1.4',
  '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
  '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
  '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
  '4 0 obj << /Length 44 >>',
  'stream',
  'BT /F1 24 Tf 20 100 Td (Hello) Tj ET',
  'endstream endobj',
  '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  'trailer << /Root 1 0 R /Size 6 >>',
  '%%EOF',
  '',
].join(NL)

/** Write a compilable project into `dir`; returns `dir`. */
function makeProject(dir, options = {}) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'main.tex'), options.tex ?? FIXTURE_TEX, 'utf8')
  const bib = options.bib === undefined ? FIXTURE_BIB : options.bib
  if (bib !== null) writeFileSync(join(dir, 'refs.bib'), bib, 'utf8')
  return dir
}

// --- tools layer: map @deepseek-ai/dsh-tools onto a validating stub ---------
const STUB_SOURCE = "const ANNOTATIONS = ['description','title','default','examples']\nconst SCALARS = ['string','number','integer','boolean','null']\nfunction isPlainObject(v){ return v !== null && typeof v === 'object' && !Array.isArray(v) }\nfunction fail(message){ throw new Error('defineTool schema: ' + message) }\nfunction checkValue(input, path, allowRequired) {\n  if (!isPlainObject(input)) fail(path + ' must be a value schema object')\n  const allowed = [...ANNOTATIONS, ...(allowRequired ? ['required'] : [])]\n  if (input.required !== undefined && input.required !== true) fail(path + '.required must be true when present')\n  if (Object.hasOwn(input, 'oneOf')) {\n    for (const key of Object.keys(input)) if (![...allowed, 'oneOf', 'type'].includes(key)) fail(path + '.' + key + ' unsupported')\n    if (Object.hasOwn(input, 'type')) fail(path + ' cannot declare both type and oneOf')\n    if (!Array.isArray(input.oneOf) || input.oneOf.length < 2) fail(path + '.oneOf must have >= 2 branches')\n    input.oneOf.forEach((branch, index) => checkValue(branch, path + '.oneOf[' + index + ']', false))\n    return\n  }\n  const type = input.type\n  if (type === undefined) fail(path + '.type is required')\n  if (type === 'object') {\n    for (const key of Object.keys(input)) if (![...allowed, 'type', 'properties', 'additionalProperties'].includes(key)) fail(path + '.' + key + ' unsupported on object')\n    if (typeof input.additionalProperties !== 'boolean') fail(path + '.additionalProperties must be explicitly true or false')\n    if (input.properties !== undefined) {\n      if (!isPlainObject(input.properties)) fail(path + '.properties must be an object')\n      for (const [key, value] of Object.entries(input.properties)) checkValue(value, path + '.properties.' + key, true)\n    }\n    return\n  }\n  if (type === 'array') {\n    for (const key of Object.keys(input)) if (![...allowed, 'type', 'items'].includes(key)) fail(path + '.' + key + ' unsupported on array')\n    if (input.items !== undefined) checkValue(input.items, path + '.items', false)\n    return\n  }\n  if (SCALARS.includes(type)) {\n    for (const key of Object.keys(input)) if (![...allowed, 'type', 'enum', 'const'].includes(key)) fail(path + '.' + key + ' unsupported on ' + type)\n    if (input.enum !== undefined && (!Array.isArray(input.enum) || input.enum.length === 0)) fail(path + '.enum must be a non-empty array')\n    return\n  }\n  if (type === 'json') {\n    for (const key of Object.keys(input)) if (![...allowed, 'type'].includes(key)) fail(path + '.' + key + ' unsupported on json')\n    return\n  }\n  fail(path + '.type is invalid: ' + String(type))\n}\nfunction checkParameters(spec) {\n  if (!isPlainObject(spec)) fail('parameters must be an object')\n  for (const [key, value] of Object.entries(spec)) checkValue(value, 'parameters.' + key, true)\n}\nexport function defineTool(options) {\n  if (typeof options.name !== 'string' || options.name === '') fail('name is required')\n  if (typeof options.description !== 'string' || options.description === '') fail(options.name + ': description is required')\n  if (typeof options.execute !== 'function') fail(options.name + ': execute is required')\n  if (!isPlainObject(options.output) || typeof options.output.render !== 'function') fail(options.name + ': output.render is required')\n  checkParameters(options.parameters)\n  checkValue(options.output.schema, 'schema', false)\n  return { name: options.name, description: options.description, parameters: options.parameters, output: options.output, execute: options.execute, timeoutMs: options.timeoutMs, presentCall: options.presentCall }\n}"
let daily = null
let dailyImportError = null
if (typeof registerHooks === 'function') {
  const stubUrl = 'data:text/javascript;base64,' + Buffer.from(STUB_SOURCE, 'utf8').toString('base64')
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '@deepseek-ai/dsh-tools') return { url: stubUrl, shortCircuit: true }
      return nextResolve(specifier, context)
    },
  })
  try {
    daily = await import('../lib/tools/daily.js')
  } catch (error) {
    daily = null
    dailyImportError = error
    console.error('failed to import tools/daily.js through the stub:', error)
  }
}

/**
 * Guard against the "green because everything skipped" failure mode.
 *
 * The tool-layer tests below are declared with `{ skip: daily === null }`, so a
 * broken import used to turn them into silent skips and the suite still reported
 * ALL GREEN while the whole A-line tool surface was dead. This test makes that
 * state loud. It only skips when the stub hook itself is unavailable, which is a
 * genuine environment limitation rather than a code defect.
 */
test('tools: the daily tool layer must be importable through the stub hook', { skip: typeof registerHooks !== 'function' ? 'node:module registerHooks unavailable on this Node' : false }, () => {
  assert.equal(
    daily === null,
    false,
    'tools/daily.js failed to import through the dsh-tools stub, so every tool-layer test below would skip: ' + String(dailyImportError?.message ?? dailyImportError),
  )
})

function fakeContext(sink) {
  return {
    tools: {
      register(tool) {
        sink.push(tool)
        return () => {}
      },
    },
    logger: { warn() {}, info() {} },
  }
}

function loadTools() {
  const registered = []
  daily.registerDaily(fakeContext(registered), {})
  return registered
}

// --- env -------------------------------------------------------------------
test('env: resolveTool finds the MiKTeX toolchain and rejects bogus names', async () => {
  const pdflatex = resolveTool('pdflatex')
  assert.ok(pdflatex, 'pdflatex must resolve from PATH or the MiKTeX bin dir')
  assert.equal(resolveTool('no-such-tool-xyz'), null)
  assert.equal(resolveTool(''), null)

  const report = await probeEnv({ uploadScope: 'external-only' })
  assert.ok(['pdflatex', 'xelatex', 'lualatex'].includes(report.latex.command))
  assert.ok(report.latex.path)
  assert.equal(typeof report.latex.isMiKTeX, 'boolean')
  assert.deepEqual(report.config.rendererOrder, ['poppler', 'miktex-ghostscript', 'mineru-page'])
  assert.equal(report.node.version, process.version)
  assert.ok(Array.isArray(report.advice))
  if (report.latex.isMiKTeX) {
    assert.ok(report.ghostscript.mgs, 'MiKTeX ships mgs.exe and env must report it')
    assert.ok(report.latex.biber, 'MiKTeX ships biber and env must report it')
    assert.ok(report.latex.chktex, 'miktex-chktex must be reported')
  }
})

// --- logparse --------------------------------------------------------------
test('logparse: a successful engine log yields success, pages and no errors', () => {
  const log = [
    '**',
    '(./main.tex',
    'LaTeX2e <2021-11-15> patch level 1',
    '(./article.cls',
    'Document Class: article 2021/10/04 v1.4n Standard LaTeX document class',
    ')',
    ' (./main.aux)',
    ' (./main.bbl) [1',
    '',
    '] [2] (./main.aux) )',
    'Output written on main.pdf (2 pages, 111690 bytes).',
    'Transcript written on main.log.',
  ].join(NL)
  const report = parseLatexLog(log)
  assert.equal(report.compileSuccess, true)
  assert.equal(report.pages, 2)
  assert.equal(report.errors.length, 0)
  assert.ok(Array.isArray(report.overfull) && Array.isArray(report.underfull))
})

test('logparse: reports file and line through a path with spaces and CJK', () => {
  const log = [
    '**',
    '(D:/Documents/deepseek harness/DSH插件管理/latex-demo/main.tex',
    'LaTeX2e <2021-11-15> patch level 1',
    'D:/Documents/deepseek harness/DSH插件管理/latex-demo/main.tex:23: Undefined control sequence.',
    'l.23 ' + T + 'notacommand',
    '',
    '! Emergency stop.',
  ].join(NL)
  const report = parseLatexLog(log)
  assert.equal(report.compileSuccess, false)
  assert.ok(report.errors.length >= 1)
  assert.ok(report.errors[0].file.endsWith('main.tex'))
  assert.equal(report.errors[0].line, 23)
  assert.match(report.errors[0].message, /Undefined control sequence/)
})

test('logparse: classic ! errors, boxes and undefined citations', () => {
  const log = [
    '! Undefined control sequence.',
    'l.7 ' + T + 'boguscommand',
    'Overfull ' + T + 'hbox (12.5pt too wide) in paragraph at lines 10--12',
    'Underfull ' + T + 'hbox (badness 10000) in paragraph at lines 20--21',
    "LaTeX Warning: Citation " + BQ + "smith2020' on page 1 undefined on input line 33.",
    "LaTeX Warning: Reference " + BQ + "fig:x' on page 1 undefined on input line 34.",
    'Output written on main.pdf (3 pages, 1000 bytes).',
  ].join(NL)
  const report = parseLatexLog(log)
  assert.equal(report.pages, 3)
  assert.equal(report.compileSuccess, false)
  assert.equal(report.errors[0].line, 7)
  assert.equal(report.overfull.length, 1)
  assert.equal(report.overfull[0].amountPt, 12.5)
  assert.equal(report.overfull[0].line, 10)
  assert.equal(report.underfull.length, 1)
  assert.deepEqual(report.missingCitations, ['smith2020'])
  assert.deepEqual(report.missingRefs, ['fig:x'])
  assert.ok(report.warnings.some((warning) => warning.kind === 'overfull'))
})

test('logparse: empty input never throws', () => {
  for (const value of [null, undefined, '', 'not a log at all']) {
    const report = parseLatexLog(value)
    assert.equal(typeof report.compileSuccess, 'boolean')
    assert.deepEqual(report.errors, [])
  }
})

// --- bib -------------------------------------------------------------------
test('bib: parseBib reports completeness and fields', () => {
  const good = parseBib(FIXTURE_BIB)
  assert.equal(good.complete, true)
  assert.deepEqual(good.entries.map((entry) => entry.key), ['knuth1984texbook', 'vaswani2017attention', 'li2024unused'])
  assert.equal(good.entries[0].type, 'book')
  assert.equal(good.entries[0].fields.author, 'Knuth, Donald E.')

  const broken = parseBib(BROKEN_BIB)
  assert.equal(broken.complete, false, 'a missing closing brace must mark the file incomplete')
})

test('bib: incomplete files are refused and left untouched', async () => {
  const work = tempDir('dsh-bib-')
  const target = join(work, 'refs.bib')
  try {
    writeFileSync(target, BROKEN_BIB, 'utf8')
    const before = readFileSync(target, 'utf8')
    const result = await bibAction({ action: 'format', bibPath: target, write: true, config: {} })
    assert.equal(result.ok, false)
    assert.equal(result.written, false)
    assert.equal(result.error.code, 'PARSE_INCOMPLETE')
    assert.equal(readFileSync(target, 'utf8'), before, 'the file must not be modified')

    const lint = await bibAction({ action: 'lint', bibPath: target, config: {} })
    assert.equal(lint.ok, false)
    assert.ok(lint.issues.some((issue) => issue.code === 'PARSE_INCOMPLETE'))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test('bib: format writes atomically with a backup; audit reconciles citations', async () => {
  const work = tempDir('dsh-bib-')
  const target = join(work, 'refs.bib')
  try {
    makeProject(work)
    writeFileSync(target, FIXTURE_BIB, 'utf8')
    const preview = await bibAction({ action: 'format', bibPath: target, write: false, config: {} })
    assert.equal(preview.ok, true)
    assert.equal(preview.written, false)
    assert.equal(readFileSync(target, 'utf8'), FIXTURE_BIB)

    const written = await bibAction({ action: 'format', bibPath: target, write: true, config: {} })
    assert.equal(written.ok, true)
    assert.equal(written.written, true)
    assert.ok(existsSync(target + '.bak'))
    assert.equal(parseBib(readFileSync(target, 'utf8')).complete, true)

    const audit = await bibAction({
      action: 'audit',
      bibPath: target,
      texFiles: [join(work, 'main.tex')],
      config: {},
    })
    assert.deepEqual(audit.missingInBib, [])
    assert.deepEqual(audit.uncited, ['li2024unused'])
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

// --- lint ------------------------------------------------------------------
test('lint: project rules, protected inventory, chktex off by default', () => {
  const work = tempDir('dsh-lint-')
  try {
    makeProject(work)
    const report = lintProject({ dir: work, entry: 'main.tex', config: {} })
    assert.equal(report.external.chktex, 'skipped', 'chktex is an optional channel and must stay off by default')
    assert.equal(report.findings.some((finding) => finding.rule.startsWith('chktex.')), false)
    assert.deepEqual(report.protected.cites, ['knuth1984texbook', 'vaswani2017attention'])
    assert.ok(report.protected.labels.includes('eq:main'))
    assert.ok(report.findings.some((finding) => finding.rule === 'orphan-label'))
    assert.ok(Array.isArray(report.advice))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test('lint: enableChktex=true actually runs chktex and pins external state', () => {
  const work = tempDir('dsh-lint-')
  try {
    makeProject(work)
    const report = lintProject({ dir: work, entry: 'main.tex', config: { enableChktex: true } })
    if (resolveTool('miktex-chktex') || resolveTool('chktex')) {
      assert.equal(report.external.chktex, 'used', JSON.stringify(report.advice))
      assert.ok(report.findings.some((finding) => finding.rule.startsWith('chktex.')), 'the fixture has chktex warnings')
      for (const finding of report.findings.filter((item) => item.rule.startsWith('chktex.'))) {
        assert.equal(finding.severity, 'minor')
        assert.equal(typeof finding.line, 'number')
      }
    } else {
      assert.equal(report.external.chktex, 'unavailable')
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test('lint: enableChktex=true with an unusable binary reports unavailable', () => {
  const work = tempDir('dsh-lint-')
  try {
    makeProject(work)
    const report = lintProject({
      dir: work,
      entry: 'main.tex',
      config: { enableChktex: true, chktexPath: join(work, 'definitely-no-chktex-here.exe') },
    })
    assert.equal(report.external.chktex, 'unavailable')
    assert.equal(report.findings.some((finding) => finding.rule.startsWith('chktex.')), false)
    assert.ok(report.advice.some((item) => /chktex/i.test(item.message)))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test('lint: pseudo-fix rules fire on a crafted source', () => {
  const work = tempDir('dsh-lint-')
  try {
    writeFileSync(join(work, 'refs.bib'), '@article{other2020,' + NL + '  title = {Other},' + NL + '  year = {2020}' + NL + '}' + NL)
    const lines = [
      T + 'documentclass{article}',
      T + 'begin{document}',
      T + 'section{X}',
      T + 'label{sec:unused}',
      T + 'begin{table}',
      T + 'resizebox{' + T + 'linewidth}{!}{' + T + 'begin{tabular}{ll}a&b' + T + 'end{tabular}}',
      T + 'end{table}',
      T + 'vspace{-2mm}',
      '{' + T + 'tiny small}',
      T + 'ref{fig:missing}',
      T + 'citep{notinbib2020}',
      T + 'end{document}',
    ]
    writeFileSync(join(work, 'main.tex'), lines.join(NL))
    const report = lintProject({ dir: work, entry: 'main.tex', config: {} })
    const rules = new Set(report.findings.map((finding) => finding.rule))
    for (const rule of ['no-resizebox', 'bare-vspace', 'tiny-font', 'undefined-ref', 'cite-not-in-bib', 'orphan-label']) {
      assert.ok(rules.has(rule), 'expected rule to fire: ' + rule)
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test('lint: extractProtected collects cites, labels, refs and numeric tokens', () => {
  const protectedSet = extractProtected([
    { path: 'a.tex', text: T + 'citep{k1,k2} ' + T + 'label{fig:x} ' + T + 'ref{fig:x} 42 and 3.14' },
  ])
  assert.deepEqual(protectedSet.cites, ['k1', 'k2'])
  assert.deepEqual(protectedSet.labels, ['fig:x'])
  assert.deepEqual(protectedSet.refs, ['fig:x'])
  assert.ok(protectedSet.numericTokens.includes('42'))
  assert.ok(protectedSet.numericTokens.includes('3.14'))
})

// --- compile ---------------------------------------------------------------
test('compile: a missing engine degrades to skipped with advice', async () => {
  const work = tempDir('dsh-compile-')
  try {
    makeProject(work)
    const result = await build({ dir: work, entry: 'main.tex', config: { latexCommand: 'no-such-engine-xyz' } })
    assert.equal(result.status, 'skipped')
    assert.equal(result.reason, 'ENGINE_NOT_FOUND')
    assert.ok(result.advice.length > 0)
    assert.equal(typeof result.durationMs, 'number')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test('compile: a missing project directory degrades to skipped', async () => {
  const result = await build({ dir: join(tmpdir(), 'dsh-definitely-missing-' + Date.now()), entry: 'main.tex', config: {} })
  assert.equal(result.status, 'skipped')
  assert.equal(result.reason, 'PROJECT_DIR_NOT_FOUND')
})

test('compile: real multi-pass build, error injection and recovery', { timeout: 300000 }, async (t) => {
  if (!resolveTool('pdflatex')) {
    t.skip('no TeX engine on this machine')
    return
  }
  const work = tempDir('dsh-compile-')
  const texPath = join(work, 'main.tex')
  try {
    makeProject(work)
    const original = readFileSync(texPath, 'utf8')
    try {
      const first = await build({ dir: work, entry: 'main.tex', clean: true, config: { compileTimeoutMs: 180000 } })
      assert.equal(first.status, 'passed', 'clean build must pass: ' + first.reason + NL + String(first.logTail).slice(-600))
      assert.equal(first.pages, 2)
      assert.ok(first.passes >= 2, 'a document with a bibliography needs several passes')
      assert.ok(first.pdfPath && existsSync(first.pdfPath))
      assert.ok(first.logPath && existsSync(first.logPath))
      // The real engine log must round-trip through the parser.
      const parsed = parseLatexLog(readFileSync(first.logPath, 'utf8'))
      assert.equal(parsed.compileSuccess, true)
      assert.equal(parsed.pages, 2)
      assert.equal(parsed.errors.length, 0)

      const marker = T + 'section{Introduction}'
      const injected = original.replace(marker, T + 'notacommand' + NL + marker)
      writeFileSync(texPath, injected, 'utf8')
      const expectedLine = injected.split(NL).findIndex((line) => line.includes('notacommand')) + 1
      const broken = await build({ dir: work, entry: 'main.tex', clean: true, config: { compileTimeoutMs: 180000 } })
      assert.equal(broken.status, 'failed')
      assert.ok(broken.errors.length >= 1, 'the injected error must be reported')
      assert.equal(broken.errors[0].line, expectedLine)
      assert.ok(broken.errors[0].file.endsWith('main.tex'))
      assert.match(broken.errors[0].message, /Undefined control sequence/)
    } finally {
      writeFileSync(texPath, original, 'utf8')
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

// --- tools -----------------------------------------------------------------
test('tools: registerDaily registers four schema-valid tools', { skip: daily === null }, () => {
  const registered = []
  const disposers = daily.registerDaily(fakeContext(registered), {})
  assert.equal(disposers.length, 4, 'all four tools must register without a schema error')
  assert.deepEqual(registered.map((tool) => tool.name).sort(), ['bib_tool', 'latex_build', 'latex_doctor', 'latex_lint'])
  for (const tool of registered) {
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.description.length > 0)
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(typeof tool.execute, 'function')
  }
})

test('tools: absolute paths and .. are rejected', { skip: daily === null }, async () => {
  const registered = loadTools()
  const buildTool = registered.find((tool) => tool.name === 'latex_build')
  const lintTool = registered.find((tool) => tool.name === 'latex_lint')

  for (const bad of ['C:/Windows', '/etc/passwd', '..', '../latex-demo', 'a/../../b']) {
    const result = await buildTool.execute({ dir: bad, entry: 'main.tex' }, {})
    assert.equal(result.status, 'skipped', 'must reject: ' + bad)
    assert.equal(result.reason, 'INVALID_PATH')
  }
  const lintResult = await lintTool.execute({ dir: 'C:/Windows' }, {})
  assert.equal(lintResult.status, 'skipped')

  assert.equal(daily.workspaceRelativePath('proj').ok, true)
  assert.equal(daily.workspaceRelativePath('C:' + BS + 'absolute').ok, false)
  assert.equal(daily.workspaceRelativePath('x/../y').ok, false)
})

test('tools: workspaceRelativePath accepts forward-slash roots (E4)', { skip: daily === null }, async () => {
  const slashRoot = WORKSPACE.replace(/\\/g, '/')
  for (const root of [WORKSPACE, slashRoot, slashRoot + '/', WORKSPACE + BS]) {
    const inside = daily.workspaceRelativePath('latex-demo/main.tex', root)
    assert.equal(inside.ok, true, 'root rejected: ' + root + ' -> ' + inside.message)
    assert.equal(inside.rel, 'latex-demo/main.tex')
    assert.equal(daily.workspaceRelativePath('C:/x', root).ok, false)
    assert.equal(daily.workspaceRelativePath('a/../b', root).ok, false)
  }

  // and the same root through a real tool call (session cwd uses forward slashes)
  const work = tempDir('dsh-fwd-')
  try {
    makeProject(join(work, 'proj'))
    const lintTool = loadTools().find((tool) => tool.name === 'latex_lint')
    const forwardCwd = work.replace(/\\/g, '/')
    const value = await lintTool.execute({ dir: 'proj', entry: 'main.tex' }, { agent: { session: { header: { cwd: forwardCwd } } } })
    assert.ok(['clean', 'issues'].includes(value.status), JSON.stringify(value.advice))
    assert.ok(value.protected.cites.includes('knuth1984texbook'))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test('tools: latex_lint runs on a workspace-relative project', { skip: daily === null }, async () => {
  const lintTool = loadTools().find((tool) => tool.name === 'latex_lint')
  const work = tempDir('dsh-lint-ws-')
  const previous = process.cwd()
  try {
    makeProject(join(work, 'proj'))
    process.chdir(work)
    const value = await lintTool.execute({ dir: 'proj', entry: 'main.tex' }, {})
    assert.ok(['clean', 'issues'].includes(value.status))
    assert.ok(value.protected.cites.includes('knuth1984texbook'))
    assert.ok(Array.isArray(value.findings))
    assert.equal(value.external.chktex, 'skipped', 'the default patch leaves the optional chktex channel off')
  } finally {
    process.chdir(previous)
    rmSync(work, { recursive: true, force: true })
  }
})

test('tools: bib_tool previews and audits inside the workspace', { skip: daily === null }, async () => {
  const bibTool = loadTools().find((tool) => tool.name === 'bib_tool')
  const work = tempDir('dsh-tool-ws-')
  const previous = process.cwd()
  try {
    makeProject(work)
    process.chdir(work)
    const lint = await bibTool.execute({ action: 'lint', bib: 'refs.bib' }, {})
    assert.equal(lint.ok, true)
    assert.equal(lint.written, false)

    const audit = await bibTool.execute({ action: 'audit', bib: 'refs.bib', tex: ['main.tex'] }, {})
    assert.equal(audit.ok, true)
    assert.deepEqual(audit.missingInBib, [])
    assert.deepEqual(audit.uncited, ['li2024unused'])

    const rejected = await bibTool.execute({ action: 'lint', bib: 'C:/nope.bib' }, {})
    assert.equal(rejected.status, 'skipped')
  } finally {
    process.chdir(previous)
    rmSync(work, { recursive: true, force: true })
  }
})

test('tools: latex_doctor renderProbe is skipped by default', { skip: daily === null, timeout: 90000 }, async () => {
  const doctor = loadTools().find((tool) => tool.name === 'latex_doctor')

  const off = await doctor.execute({}, {})
  assert.equal(off.renderProbe.status, 'skipped')
  assert.equal(off.renderProbe.bytes, null)

  const missing = await doctor.execute({ verifyPdfRead: true }, {})
  assert.equal(missing.renderProbe.status, 'skipped')
  assert.match(String(missing.renderProbe.reason), /pdfPath/)
})

test('tools: latex_doctor verifyPdfRead really renders page 1', { skip: daily === null, timeout: 120000 }, async () => {
  const doctor = loadTools().find((tool) => tool.name === 'latex_doctor')
  const work = tempDir('dsh-render-')
  const previous = process.cwd()
  try {
    const project = makeProject(join(work, 'proj'))
    writeFileSync(join(project, 'out.pdf'), MINIMAL_PDF, 'utf8')
    process.chdir(work)
    const value = await doctor.execute({ verifyPdfRead: true, pdfPath: 'proj/out.pdf' }, {})
    assert.equal(existsSync(join(project, 'pages')), false, 'a probe must not drop pages/ into the project root')
    assert.equal(existsSync(join(project, 'aux')), false, 'the auxiliary dir must never use the reserved name aux')
    if (resolveTool('pdftoppm')) {
      assert.equal(value.renderProbe.status, 'ok', JSON.stringify(value.renderProbe))
      assert.equal(value.renderProbe.backend, 'poppler')
      assert.ok(value.renderProbe.bytes > 0, 'the rendered PNG must have bytes')
      assert.ok(String(value.renderProbe.path).includes('.latex-studio'), 'probe output must stay inside the workDir')
    } else {
      assert.ok(['ok', 'skipped', 'failed'].includes(value.renderProbe.status))
    }
  } finally {
    process.chdir(previous)
    rmSync(work, { recursive: true, force: true })
  }
})

test('tools: the session workspace cwd wins over process.cwd()', { skip: daily === null, timeout: 120000 }, async () => {
  const neutral = tempDir('dsh-neutral-')
  const previous = process.cwd()
  process.chdir(neutral)
  try {
    assert.equal(existsSync(join(process.cwd(), 'proj')), false, 'the neutral cwd must not contain the project')
    const project = makeProject(join(tempDir('dsh-session-'), 'proj'))

    const lintTool = loadTools().find((tool) => tool.name === 'latex_lint')

    // 1) session header cwd
    const bySession = await lintTool.execute({ dir: 'proj', entry: 'main.tex' }, { agent: { session: { header: { cwd: dirname(project) } } } })
    assert.ok(bySession.protected.cites.includes('knuth1984texbook'), JSON.stringify(bySession.advice))
    assert.ok(['clean', 'issues'].includes(bySession.status))

    // 2) fs service cwd
    const fsCtx = {
      tools: { register(tool) { fsRegistered.push(tool); return () => {} } },
      get: (name) => (name === 'fs' ? { cwd: dirname(project) } : undefined),
      logger: { warn() {} },
    }
    const fsRegistered = []
    daily.registerDaily(fsCtx, {})
    const byFs = await fsRegistered.find((tool) => tool.name === 'latex_lint').execute({ dir: 'proj', entry: 'main.tex' }, {})
    assert.ok(byFs.protected.cites.includes('knuth1984texbook'), JSON.stringify(byFs.advice))

    // 3) helper semantics
    assert.equal(daily.sessionCwd(fsCtx, {}), dirname(project))
    assert.equal(daily.sessionCwd({}, { agent: { session: { header: { cwd: dirname(project) } } } }), dirname(project))
    assert.equal(daily.sessionCwd({}, {}), process.cwd())
  } finally {
    process.chdir(previous)
    rmSync(neutral, { recursive: true, force: true })
  }
})

