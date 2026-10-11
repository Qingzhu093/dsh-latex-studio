/**
 * Compile-driver selection (0.2.0).
 *
 * The default is "latexmk when it can actually run, built-in multi-pass driver
 * otherwise". Both branches are asserted here so the external dependency can
 * never turn this file into a silent skip: with Perl+latexmk present the latexmk
 * driver must produce a real PDF; without them the same call must fall back and
 * say why.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from '../lib/core/compile.js'
import { latexmkStatus } from '../lib/core/env.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEMO = path.resolve(HERE, '..', '..', 'latex-demo')

function makeProject() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'driver-test-'))
  fs.copyFileSync(path.join(DEMO, 'main.tex'), path.join(work, 'main.tex'))
  fs.copyFileSync(path.join(DEMO, 'refs.bib'), path.join(work, 'refs.bib'))
  return work
}

test('driver: latexmkStatus reports path/perl/version coherently', () => {
  const status = latexmkStatus()
  assert.equal(typeof status.usable, 'boolean')
  assert.equal(typeof status.path, 'string')
  if (status.usable) {
    assert.match(String(status.version), /^Latexmk/i, 'a usable latexmk must report its version line')
    assert.ok(status.perl, 'a usable latexmk implies a resolved perl')
  } else {
    assert.equal(status.version, null)
    assert.ok(status.reason, 'an unusable latexmk must explain why')
  }
})

test('driver: auto prefers latexmk when available, else falls back with an explanation', async () => {
  const work = makeProject()
  try {
    const status = latexmkStatus()
    const result = await build({ dir: work, engine: 'auto', config: {} })
    assert.equal(result.status, 'passed', 'the sample project must compile: ' + JSON.stringify({ status: result.status, reason: result.reason }))
    assert.ok(result.pdfPath && fs.existsSync(result.pdfPath), 'a PDF must be produced')
    assert.equal(result.pages, 2)
    if (status.usable) {
      assert.equal(result.via, 'latexmk')
      assert.equal(result.stopReason, 'latexmk')
      assert.ok(result.passes >= 1, 'latexmk reports its engine runs')
      assert.ok(result.latexmk && result.latexmk.perl, 'the result records which perl was used')
    } else {
      assert.equal(result.via, 'builtin')
      assert.ok(['stable', 'max-passes'].includes(result.stopReason), 'built-in driver reports why it stopped: ' + result.stopReason)
      const forced = await build({ dir: work, engine: 'auto', config: { latexCommand: 'latexmk' } })
      assert.equal(forced.via, 'builtin', 'an unusable latexmk must not be selected')
      assert.ok((forced.advice || []).some((a) => /latexmk/.test(String(a.message))), 'the fallback must say why')
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
})

test('driver: an explicit engine bypasses latexmk (no silent driver swap)', async () => {
  const work = makeProject()
  try {
    const result = await build({ dir: work, engine: 'pdflatex', config: {} })
    assert.equal(result.status, 'passed')
    assert.equal(result.via, 'builtin', 'an explicitly requested engine is driven directly')
    assert.equal(result.engine, 'pdflatex')
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
})
