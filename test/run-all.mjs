#!/usr/bin/env node
/**
 * dsh-latex-studio — aggregate test runner.
 *
 * Runs every `test/*.test.mjs` (node:test) in its own child process, parses the
 * TAP stream, and prints one summary table plus an explicit pass/fail verdict.
 *
 * Usage (from the plugin root):
 *   node test/run-all.mjs                  # run all test/*.test.mjs
 *   node test/run-all.mjs guard policy     # only files whose name contains a filter
 *   node test/run-all.mjs --verbose        # also echo every child's raw output
 *   node test/run-all.mjs --json           # machine-readable summary on stdout
 *
 * Exit code: 0 when every discovered file passed (or when no test file exists),
 *            1 when at least one file failed, 2 when the runner itself broke.
 *
 * No @deepseek-ai/* imports: this script is plain Node ESM and runs standalone.
 */
import { readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(testDir, '..')

const argv = process.argv.slice(2)
const verbose = argv.includes('--verbose')
const asJson = argv.includes('--json')
const filters = argv.filter((a) => !a.startsWith('--'))

/** Locate the aggregate-able test files (top-level `test/*.test.mjs`). */
async function discoverTests() {
  let names = []
  try {
    names = await readdir(testDir)
  } catch {
    return []
  }
  return names
    .filter((n) => n.endsWith('.test.mjs'))
    .filter((n) => filters.length === 0 || filters.some((f) => n.includes(f)))
    .sort()
    .map((n) => path.join(testDir, n))
}

/** Run one test file through `node --test` and capture its TAP output. */
function runTestFile(file) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', file], {
      cwd: pluginRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', (error) => {
      resolve({ file, code: 1, stdout, stderr: String(error?.message ?? error), spawnFailed: true, ms: Date.now() - started })
    })
    child.on('close', (code) => {
      resolve({ file, code: code ?? 1, stdout, stderr, spawnFailed: false, ms: Date.now() - started })
    })
  })
}

/** Parse a Node TAP stream into counts + individual test outcomes. */
function parseTap(tap) {
  const counts = {}
  for (const m of tap.matchAll(/^#\s*(tests|pass|fail|skipped|todo|cancelled|duration_ms)\s+(\S+)\s*$/gm)) {
    counts[m[1]] = m[2]
  }
  const tests = []
  for (const m of tap.matchAll(/^(\s*)(not ok|ok)\s+\d+\s+-\s+(.*)$/gm)) {
    tests.push({ ok: m[2] === 'ok', name: m[3].trim(), nested: m[1].length > 0 })
  }
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
  const failed = tests.filter((t) => !t.ok)
  return {
    tests,
    failed,
    total: num(counts.tests),
    passed: num(counts.pass),
    failedCount: num(counts.fail),
    skipped: num(counts.skipped),
    todo: num(counts.todo),
    cancelled: num(counts.cancelled),
  }
}

function pad(s, n) {
  const str = String(s)
  return str.length >= n ? str : str + ' '.repeat(n - str.length)
}

async function main() {
  const files = await discoverTests()
  const rel = (f) => path.relative(pluginRoot, f).split(path.sep).join('/')

  if (files.length === 0) {
    const msg = filters.length
      ? 'no test/*.test.mjs matched filter: ' + filters.join(', ')
      : 'no test/*.test.mjs found yet'
    if (!asJson) {
      console.log('[run-all] ' + msg)
      console.log('[run-all] nothing to run — exit 0')
    } else {
      console.log(JSON.stringify({ files: [], total: 0, passed: 0, failed: 0, ok: true, note: msg }, null, 2))
    }
    return 0
  }

  if (!asJson) {
    console.log('[run-all] dsh-latex-studio test aggregation')
    console.log('[run-all] node ' + process.version + ' · root ' + pluginRoot)
    console.log('[run-all] discovered ' + files.length + ' file(s): ' + files.map(rel).join(', '))
    console.log('')
  }

  const results = []
  for (const file of files) {
    const run = await runTestFile(file)
    const parsed = parseTap(run.stdout + '\n' + run.stderr)
    const passedCount = parsed.passed ?? parsed.tests.filter((t) => t.ok).length
    const failedCount = parsed.failedCount ?? parsed.failed.length
    const totalCount = parsed.total ?? parsed.tests.length
    const ok = run.code === 0 && failedCount === 0
    results.push({ file: rel(file), ...parsed, passed: passedCount, failedCount, total: totalCount, ok, code: run.code, ms: run.ms, spawnFailed: run.spawnFailed })

    if (!asJson) {
      console.log((ok ? '  PASS  ' : '  FAIL  ') + pad(rel(file), 34) + ' ' + passedCount + '/' + totalCount + ' passed' + (failedCount ? ', ' + failedCount + ' failed' : '') + '  (' + run.ms + ' ms)')
      for (const f of parsed.failed) {
        const name = f.name.replace(/\s+/g, ' ').slice(0, 110)
        console.log('         ✗ ' + (f.nested ? '(subtest) ' : '') + name)
      }
      if (run.spawnFailed) console.log('         ✗ runner failed: ' + run.stderr.slice(0, 200))
      if (verbose) {
        console.log('  --- raw output of ' + rel(file) + ' ---')
        console.log((run.stdout + run.stderr).trimEnd().split('\n').map((l) => '  | ' + l).join('\n'))
        console.log('  --- end ' + rel(file) + ' ---')
      }
    }
  }

  const sum = (k) => results.reduce((a, r) => a + (Number(r[k]) || 0), 0)
  const totalPassed = sum('passed')
  const totalFailed = sum('failedCount')
  const totalTests = sum('total')
  const totalSkipped = sum('skipped')
  const allOk = results.every((r) => r.ok)

  if (asJson) {
    console.log(JSON.stringify({
      files: results.map((r) => ({ file: r.file, ok: r.ok, total: r.total, passed: r.passed, failed: r.failedCount, skipped: r.skipped, ms: r.ms, failedNames: r.failed.map((f) => f.name) })),
      total: totalTests,
      passed: totalPassed,
      failed: totalFailed,
      skipped: totalSkipped,
      ok: allOk,
    }, null, 2))
  } else {
    console.log('')
    console.log('──────────────────────────────────────────────')
    console.log('[run-all] summary: ' + results.length + ' file(s), ' + totalTests + ' test(s) — ' + totalPassed + ' passed, ' + totalFailed + ' failed, ' + totalSkipped + ' skipped')
    console.log('[run-all] verdict: ' + (allOk ? 'ALL GREEN' : 'FAILURES PRESENT'))
    if (!allOk) {
      console.log('[run-all] failing file(s): ' + results.filter((r) => !r.ok).map((r) => r.file).join(', '))
      console.log('[run-all] re-run one file with: node --test --test-reporter=spec ' + results.filter((r) => !r.ok)[0].file)
    }
  }
  return allOk ? 0 : 1
}

try {
  const code = await main()
  process.exitCode = code
} catch (error) {
  console.error('[run-all] runner crashed: ' + String(error?.stack ?? error))
  process.exitCode = 2
}
