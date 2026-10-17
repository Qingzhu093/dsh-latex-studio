/**
 * The committed LaTeX fixture every test that needs a real compile uses.
 *
 * WHY THIS EXISTS (regression this file prevents): `compile-driver` and
 * `parse-gate` used to copy `../../latex-demo` — a project that lives BESIDE the
 * repository, was never committed, and only happened to have a built PDF from an
 * earlier acceptance run. A fresh clone therefore failed with ENOENT, while the
 * author's checkout passed: exactly the "tests depend on historical artifacts"
 * failure the project forbids. The fixture now lives in `test/fixtures/demo`, is
 * committed, and each test copies it into its own temp directory.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from '../../lib/core/compile.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEMO = path.resolve(HERE, '..', 'fixtures', 'demo')

/** Copy the committed fixture files into a project directory. */
export function copyFixture(projectDir) {
  fs.mkdirSync(projectDir, { recursive: true })
  for (const name of ['main.tex', 'refs.bib']) {
    fs.copyFileSync(path.join(DEMO, name), path.join(projectDir, name))
  }
  return projectDir
}

/**
 * Materialize an isolated copy of the fixture project.
 * @param {{compile?: boolean, name?: string|null}} [options] - compile it for real (needed when a test consumes the PDF), and nest it under this directory name.
 * @returns {Promise<{root: string, project: string}>} temp root and the project directory inside it.
 */
export async function makeProject({ compile = false, name = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-fixture-'))
  const project = copyFixture(name === null ? root : path.join(root, name))
  if (compile) {
    const result = await build({ dir: project, engine: 'auto', config: { compileTimeoutMs: 180000 } })
    if (result.status !== 'passed') throw new Error('the committed fixture must compile: ' + JSON.stringify({ status: result.status, reason: result.reason }))
  }
  return { root, project }
}
