/**
 * vto_inspect.parse: the upload gate must actually gate.
 *
 * Until 0.2.0 `parse` was a no-op — the gate result was printed and nothing was
 * ever parsed. This test drives the real registered tool with a stub read_pdf and
 * asserts both halves: the default scope must not touch the provider at all, and
 * explicit consent must produce the structured payload.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { makeProject } from './helpers/demo.mjs'

test('parse gate: no upload without consent, structured payload with it', async () => {
  const { apply, Config } = await import('../lib/index.js')
  const calls = []
  const fakeReadPdf = {
    execute: async (args) => {
      calls.push(args)
      return {
        provenance: { provider: 'fake-provider', model: 'vlm' },
        summary: { page_count: 2, table_count: 1, equation_count: 1 },
        markdown_content: '# fake parse',
        toc: [{ block_id: 'b1' }],
      }
    },
  }
  const registered = new Map()
  apply(
    {
      tools: {
        register: (tool) => { registered.set(tool.name, tool); return () => {} },
        get: (name) => (name === 'read_pdf' ? fakeReadPdf : undefined),
      },
      get: () => undefined,
      logger: { info() {}, warn() {} },
    },
    Config({}),
  )

  // The gate needs a real PDF to resolve, so the fixture is compiled here instead
  // of copying a sibling project that only had a build from an earlier run.
  const { root: work } = await makeProject({ compile: true, name: 'paper' })
  const exec = { agent: { session: { header: { cwd: work } } } }
  try {
    const denied = await registered.get('vto_inspect').execute({ dir: 'paper', pages: '1', parse: true }, exec)
    assert.equal(calls.length, 0, 'external-only must not call read_pdf for a user manuscript')
    assert.equal(denied.parsed, null)
    assert.ok((denied.notes || []).some((n) => /uploadScope/.test(n)), 'the denial must be explained: ' + JSON.stringify(denied.notes))
    assert.equal(denied.gate.allowed, false)
    assert.equal(denied.gate.uploads, true, 'the gate must describe the upload it is refusing')

    const allowed = await registered.get('vto_inspect').execute({ dir: 'paper', pages: '1', parse: true, consent: true }, exec)
    assert.equal(calls.length, 1, 'consent must produce exactly one parse call')
    assert.equal(calls[0].view, 'content')
    assert.ok(calls[0].file_path, 'the parse call must target the resolved PDF')
    assert.equal(allowed.parsed.provider, 'fake-provider')
    assert.equal(allowed.parsed.pageCount, 2)
    assert.match(allowed.parsed.excerpt, /fake parse/)
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
})
