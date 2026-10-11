/**
 * Guard for the operational entry points: `tools/doctor.mjs` and `tools/install.mjs`.
 *
 * These exist to make "is it working / how do I install it" answerable without
 * reading this package's internals. They are therefore part of the contract, and
 * a broken doctor is worse than no doctor: it would report HEALTHY while the
 * plugin is unloaded, or FAIL while everything is fine.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(HERE, '..')

/** Run a tool, returning `{status, stdout, stderr}` instead of throwing. */
function runTool(rel, args = [], options = {}) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(PKG, rel), ...args], {
      encoding: 'utf8',
      cwd: PKG,
      timeout: 180000,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    return { status: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') }
  }
}

test('doctor: reports HEALTHY on this checkout and exits 0', { timeout: 180000 }, () => {
  const result = runTool('tools/doctor.mjs')
  assert.equal(result.status, 0, 'doctor must exit 0 when everything is fine:\n' + result.stdout + result.stderr)
  assert.match(result.stdout, /verdict: HEALTHY/)
  // The checks that make it worth running at all.
  assert.match(result.stdout, /\[OK  \] tools/)
  assert.match(result.stdout, /\[OK  \] skills/)
  assert.match(result.stdout, /\[OK  \] toolchain/)
})

test('doctor: --json emits a machine-readable report with the same verdict', { timeout: 180000 }, () => {
  const result = runTool('tools/doctor.mjs', ['--json'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.package, 'dsh-latex-studio')
  assert.equal(report.failed, 0)
  assert.ok(Array.isArray(report.results) && report.results.length > 0)
  for (const entry of report.results) {
    assert.ok(['ok', 'warn', 'fail', 'skip'].includes(entry.status), 'bad status: ' + JSON.stringify(entry))
    assert.equal(typeof entry.name, 'string')
  }
  const tools = report.results.find((r) => r.name === 'tools')
  assert.equal(tools.status, 'ok')
  assert.match(tools.detail, /9 tools registered/)
  const skills = report.results.find((r) => r.name === 'skills')
  assert.equal(skills.status, 'ok')
  assert.match(skills.detail, /3 skills registered/)
})

test('doctor: a broken patch is caught rather than reported healthy', { timeout: 180000 }, () => {
  // The one regression class that silently drops every user config override.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-doctor-'))
  try {
    // A minimal copy that is complete enough to load but has a bad patch.
    for (const rel of ['lib', 'skills']) fs.cpSync(path.join(PKG, rel), path.join(dir, rel), { recursive: true })
    fs.copyFileSync(path.join(PKG, 'package.json'), path.join(dir, 'package.json'))
    fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), "- insert:\n    - id: latex-studio\n      name: 'dsh-latex-studio'\n      config:\n        enableDaily: true\n")
    const result = runTool('tools/doctor.mjs', ['--dir', dir])
    assert.notEqual(result.status, 0, 'a duplicated config block must fail the doctor')
    assert.match(result.stdout, /\[FAIL\] patch/)
    assert.match(result.stdout, /REPLACES the whole config/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('install: --dry-run changes nothing and prints the plan', { timeout: 120000 }, () => {
  const repoManifest = path.join(PKG, 'package.json')
  const before = fs.readFileSync(repoManifest, 'utf8')
  const result = runTool('tools/install.mjs', ['--dry-run'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /dry run/)
  assert.match(result.stdout, /would register/)
  assert.equal(fs.readFileSync(repoManifest, 'utf8'), before, 'dry run must not touch the repo manifest')
})

test('install: refuses to run against a profile that does not exist', { timeout: 120000 }, () => {
  const result = runTool('tools/install.mjs', ['--profile', 'no-such-profile-xyz', '--dry-run'])
  assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /profile directory not found/)
})

test('packaging: the operational tools are in the files whitelist', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'))
  // install.mjs verifies the deployed copy with doctor.mjs, so both must ship or
  // the verification step silently degrades to "cannot verify".
  assert.ok(pkg.files.includes('tools/doctor.mjs'), 'tools/doctor.mjs must ship')
  assert.ok(pkg.files.includes('tools/install.mjs'), 'tools/install.mjs must ship')
  // ...and npm scripts must point at files that exist.
  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    const match = /node\s+(\S+\.mjs)/.exec(command)
    if (!match) continue
    assert.ok(fs.existsSync(path.join(PKG, match[1])), 'script "' + name + '" points at a missing file: ' + match[1])
  }
})

test('packaging: docs/ and the removed install-skills tool do not ship', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'))
  // 0.2.0: the vendored upstream reference is repo-only; skills are registered by
  // the plugin, so the filesystem fallback installer is gone.
  assert.ok(!pkg.files.includes('docs'), 'docs/ must not ship')
  assert.ok(!pkg.files.includes('tools/install-skills.mjs'), 'install-skills.mjs must not ship')
  assert.ok(!fs.existsSync(path.join(PKG, 'tools', 'install-skills.mjs')), 'tools/install-skills.mjs must be deleted')
  assert.ok(!('install-skills' in (pkg.scripts ?? {})), 'the install-skills script must be removed')
})
