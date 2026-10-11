/**
 * Parameter-basis contract for the 0.2.0 tool surface.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Before 0.2.0 the docs claimed "every tool parameter is workspace-relative"
 * while `vto_fix.file`, `vto_start.entry` and the `pdf` arguments were in fact
 * project-relative, and `safeRel` ran its containment check against
 * `process.cwd()` before joining the result onto the project directory. A model
 * following the README got `FILE_NOT_READABLE` for a path that plainly existed.
 *
 * The contract pinned here is:
 *   - workspace: resolved against the session workspace (session cwd);
 *   - project:   resolved against the project directory named by `dir`;
 *   - name:      a plain relative directory name, never a path.
 *
 * Every declared parameter that looks like a path must be classified here, and
 * its description must state its basis. Adding a path parameter without
 * classifying it fails this test.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveProjectPath, wrongBasisHint, safeRel } from '../lib/tools/vto.js'
import { decodeToolOutput } from '../lib/core/render.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'params-test-'))

/** Canonical basis per <tool>.<param>. */
const BASIS = {
  'latex_doctor.pdfPath': 'workspace',
  'latex_build.dir': 'workspace',
  'latex_build.entry': 'project',
  'latex_lint.dir': 'workspace',
  'latex_lint.entry': 'project',
  'bib_tool.bib': 'workspace',
  'bib_tool.tex': 'workspace',
  'vto_start.dir': 'workspace',
  'vto_start.entry': 'project',
  'vto_start.workDir': 'name',
  'vto_inspect.dir': 'workspace',
  'vto_inspect.pdf': 'project',
  'vto_fix.dir': 'workspace',
  'vto_fix.file': 'project',
  'vto_verify.dir': 'workspace',
  'vto_verify.entry': 'project',
  'vto_verify.pdf': 'project',
  'vto_report.dir': 'workspace',
}

/** Phrase each basis must state in the parameter description. */
const BASIS_PHRASE = {
  workspace: /工作区相对/,
  project: /相对 dir/,
  name: /目录名/,
}

const PATH_LIKE = /^(dir|entry|file|pdf|bib|tex|pdfPath|workDir)$/

/** Register the real tool surface against a stub registry. */
async function registeredTools() {
  const { apply, Config } = await import('../lib/index.js')
  const registered = new Map()
  apply(
    {
      tools: { register: (t) => { registered.set(t.name, t); return () => {} }, get: () => undefined },
      get: () => undefined,
      logger: { info() {}, warn() {} },
    },
    Config({}),
  )
  return registered
}

const parameterEntries = (definition) => {
  const params = definition?.parameters
  if (!params || typeof params !== 'object') return []
  if (params.properties && typeof params.properties === 'object') {
    return Object.entries(params.properties).map(([k, v]) => [k, v])
  }
  return Object.entries(params)
}

test('params: every path-like parameter is classified with a basis', async () => {
  const tools = await registeredTools()
  assert.ok(tools.size >= 9, 'expected the full tool surface, got ' + [...tools.keys()].join(', '))
  const seen = new Set()
  for (const [tool, definition] of tools) {
    for (const [name, node] of parameterEntries(definition)) {
      if (!PATH_LIKE.test(name)) continue
      const key = tool + '.' + name
      seen.add(key)
      assert.ok(BASIS[key], 'path parameter ' + key + ' is not classified in BASIS')
      const description = String((node && node.description) || '')
      assert.match(description, BASIS_PHRASE[BASIS[key]], key + ' description must state its basis (' + BASIS[key] + '): ' + description)
    }
  }
  for (const key of Object.keys(BASIS)) {
    assert.ok(seen.has(key), 'BASIS lists ' + key + ' but the tool surface no longer declares it')
  }
})

test('params: side-effecting switches default to "off" (no implicit write/upload)', async () => {
  const tools = await registeredTools()
  const switches = ['apply', 'write', 'replaceAll', 'force', 'clean', 'parse', 'consent', 'verifyPdfRead']
  for (const [tool, definition] of tools) {
    for (const [name, node] of parameterEntries(definition)) {
      if (!switches.includes(name)) continue
      const description = String((node && node.description) || '')
      assert.match(description, /默认 false|默认关闭|是否/, tool + '.' + name + ' must document an explicit opt-in')
      assert.ok(!('default' in (node || {}) && node.default === true), tool + '.' + name + ' must not default to true')
    }
  }
})

test('params: resolveProjectPath resolves against dir, not the workspace', () => {
  const root = tmp()
  const project = path.join(root, 'paper')
  fs.mkdirSync(project, { recursive: true })
  fs.writeFileSync(path.join(project, 'main.tex'), 'x')
  assert.equal(resolveProjectPath(project, 'main.tex', 'file', root), 'main.tex')
  assert.throws(() => resolveProjectPath(project, path.join(root, 'paper', 'main.tex'), 'file', root), /INVALID_PATH|只接受工作区相对路径|相对/)
  assert.throws(() => resolveProjectPath(project, '../escape.tex', 'file', root), (error) => error.name === 'PathError')
  assert.throws(() => resolveProjectPath(project, 'C:/x.tex', 'file', root), (error) => error.name === 'PathError')
  assert.throws(() => resolveProjectPath(project, 'missing.tex', 'entry', root), /不存在/)
  assert.equal(resolveProjectPath(project, 'missing.tex', 'pdf', root, { mustExist: false }), 'missing.tex')
  // safeRel remains the workspace-relative guard used by the A line.
  assert.equal(safeRel('paper/main.tex', 'file', root), path.normalize('paper/main.tex'))
})

test('params: the workspace-vs-project mistake is diagnosed, not left as ENOENT', () => {
  const root = tmp()
  const project = path.join(root, 'paper')
  fs.mkdirSync(project, { recursive: true })
  fs.writeFileSync(path.join(project, 'main.tex'), 'x')
  const hint = wrongBasisHint(project, 'paper/main.tex', 'file', root)
  assert.ok(typeof hint === 'string' && hint.length > 0, 'expected an actionable hint')
  assert.match(hint, /工程目录/)
  assert.match(hint, /main\.tex/)
  // The same call through resolveProjectPath (entry defaults to mustExist) carries it.
  assert.throws(() => resolveProjectPath(project, 'paper/main.tex', 'entry', root), (error) => {
    assert.equal(error.name, 'PathError')
    assert.match(String(error.message), /工程目录/)
    return true
  })
  // No hint when the path is unambiguous.
  assert.equal(wrongBasisHint(project, 'main.tex', 'file', root), null)
})

test('render: decodeToolOutput survives UTF-16LE/BE BOM and UTF-8 output', () => {
  const text = 'Creator: TeX\r\nPages:           7\r\n'
  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
  assert.match(decodeToolOutput(utf16le), /^Pages:\s+7/m)
  const swapped = Buffer.from(text, 'utf16le')
  swapped.swap16()
  const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), swapped])
  assert.match(decodeToolOutput(utf16be), /^Pages:\s+7/m)
  const utf8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])
  assert.match(decodeToolOutput(utf8), /^Pages:\s+7/m)
  // ANSI-codepage bytes (the localised timezone case) must not destroy ASCII lines.
  const ansi = Buffer.concat([Buffer.from('CreationDate: 2026 \u4e2d\u56fd\u6807\u51c6\u65f6\u95f4\r\n'.replace(/[^\x00-\x7f]/g, '?'), 'latin1'), Buffer.from('Pages:           9\r\n', 'latin1')])
  assert.match(decodeToolOutput(ansi), /^Pages:\s+9/m)
  assert.equal(decodeToolOutput('Pages:           3\n'), 'Pages:           3\n')
});