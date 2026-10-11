#!/usr/bin/env node
/**
 * One-command health check: "is this plugin actually working here?"
 *
 * WHY THIS IS A CLI AND NOT A TOOL
 * --------------------------------
 * The most dangerous failure mode of this plugin is being *installed but not
 * loaded* — and a plugin that never reaches ACTIVE cannot register a diagnostic
 * tool to tell you so. A `latex_doctor`-style tool is useless precisely when you
 * need it. This script runs outside the plugin, so it works even when the plugin
 * does not.
 *
 * It answers, in order:
 *   1. Files     — is the package complete? (lib/core modules, skills, patch)
 *   2. Loading   — does apply() register 9 tools + the skill pack, without errors?
 *   3. Wiring    — is the bundle registered in a DSH profile?
 *   4. Shadows   — would a discovery root duplicate the self-registered skills?
 *   5. Toolchain — can LaTeX actually compile and render on this machine?
 *
 * Usage:
 *   node tools/doctor.mjs                 # check this directory
 *   node tools/doctor.mjs --dir <path>    # check another copy (e.g. the installed one)
 *   node tools/doctor.mjs --json          # machine-readable
 *   node tools/doctor.mjs --profile <name># also require this profile to list the bundle
 *
 * Exit code: 0 all checks passed, 1 something is broken, 2 the runner itself failed.
 *
 * @module tools/doctor
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_DEFAULT = path.resolve(HERE, '..')

/** Files that must exist for the plugin to load and behave. */
const REQUIRED = [
  'package.json',
  'cordis.patch.yml',
  'lib/index.js',
  'lib/config.js',
  'lib/core/skillpack.js',
  'lib/core/voidetect.js',
  'lib/core/paths.js',
  'lib/core/compile.js',
  'lib/core/lint.js',
  'lib/core/bib.js',
  'lib/core/render.js',
  'lib/core/guard.js',
  'lib/core/policy.js',
  'lib/core/state.js',
  'lib/core/report.js',
  'lib/core/logparse.js',
  'lib/core/pdfread.js',
  'lib/core/env.js',
  'lib/tools/daily.js',
  'lib/tools/vto.js',
  'lib/data/vto_taxonomy.json',
  'lib/data/layout_rules.json',
  'lib/data/diagnostic_report.template.md',
  'skills/latex-daily/SKILL.md',
  'skills/latex-vto-loop/SKILL.md',
  'skills/latex-fix-catalog/SKILL.md',
]

/** Tools the plugin must register. */
const EXPECTED_TOOLS = [
  'latex_doctor',
  'latex_build',
  'latex_lint',
  'bib_tool',
  'vto_start',
  'vto_inspect',
  'vto_fix',
  'vto_verify',
  'vto_report',
]

const ok = (name, detail = '') => ({ name, status: 'ok', detail })
const warn = (name, detail = '') => ({ name, status: 'warn', detail })
const bad = (name, detail = '') => ({ name, status: 'fail', detail })
const skip = (name, detail = '') => ({ name, status: 'skip', detail })

/** dsh home, matching the launcher's convention. */
function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

function checkFiles(pkgDir) {
  const results = []
  const missing = REQUIRED.filter((rel) => !fs.existsSync(path.join(pkgDir, rel)))
  if (missing.length > 0) {
    results.push(bad('files', missing.length + ' required file(s) missing: ' + missing.join(', ')))
  } else {
    results.push(ok('files', REQUIRED.length + ' required files present'))
  }
  // The patch must not re-introduce a config block: it replaces the whole config.
  try {
    const patch = fs.readFileSync(path.join(pkgDir, 'cordis.patch.yml'), 'utf8')
    const body = patch.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
    if (/^\s*config:/m.test(body)) {
      results.push(bad('patch', 'cordis.patch.yml carries a config: block; a patch REPLACES the whole config, so this silently drops user overrides'))
    } else if (!/name:\s*'?dsh-latex-studio'?/.test(body)) {
      results.push(bad('patch', 'cordis.patch.yml does not insert the dsh-latex-studio row'))
    } else {
      results.push(ok('patch', 'inserts the plugin row with no duplicated defaults'))
    }
  } catch (error) {
    results.push(bad('patch', String((error && error.message) || error)))
  }
  return results
}

async function checkLoading(pkgDir) {
  const results = []
  const entry = path.join(pkgDir, 'lib', 'index.js')
  if (!fs.existsSync(entry)) return [bad('loading', 'lib/index.js is missing')]

  let mod
  try {
    mod = await import(pathToFileURL(entry).href)
  } catch (error) {
    return [bad('loading', 'lib/index.js failed to import: ' + String((error && error.message) || error))]
  }

  const tools = []
  const skills = []
  const problems = []
  const ctx = {
    tools: { register: (t) => { tools.push(t.name); return () => {} } },
    get: (name) => (name === 'skills' ? { register: (s) => { skills.push(s.name); return () => {} } } : undefined),
    logger: { info() {}, warn: (...a) => problems.push(a.join(' ')) },
  }

  let outcome
  try {
    outcome = mod.apply(ctx, typeof mod.Config === 'function' ? mod.Config({}) : {})
  } catch (error) {
    return [bad('loading', 'apply() threw: ' + String((error && error.message) || error))]
  }

  const missingTools = EXPECTED_TOOLS.filter((t) => !tools.includes(t))
  if (missingTools.length > 0) {
    results.push(bad('tools', 'registered ' + tools.length + '/' + EXPECTED_TOOLS.length + '; missing: ' + missingTools.join(', ')))
  } else {
    results.push(ok('tools', EXPECTED_TOOLS.length + ' tools registered: ' + tools.join(', ')))
  }

  const skillProblems = outcome?.skills?.problems ?? []
  if (skillProblems.length > 0) {
    results.push(bad('skills', 'skill pack problems: ' + skillProblems.map((p) => p.dir + ':' + p.reason).join(', ')))
  } else if (skills.length === 0) {
    results.push(warn('skills', 'no skills registered (host may have no skills service at load time)'))
  } else {
    results.push(ok('skills', skills.length + ' skills registered: ' + skills.join(', ')))
  }

  if (problems.length > 0) {
    results.push(warn('logger', 'the plugin logged warnings during apply(): ' + problems.join(' | ')))
  }
  return results
}

function checkWiring(pkgDir, profile) {
  const results = []
  const home = dshHome()
  const profilesDir = path.join(home, 'profiles')
  if (!fs.existsSync(profilesDir)) {
    results.push(warn('profile', 'no profiles directory at ' + profilesDir))
    return results
  }
  const wanted = profile ? [profile] : fs.readdirSync(profilesDir).filter((n) => fs.existsSync(path.join(profilesDir, n, 'package.json')))
  let found = []
  for (const name of wanted) {
    const manifestPath = path.join(profilesDir, name, 'package.json')
    let manifest
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch {
      continue
    }
    const bundles = manifest?.dsh?.profile?.bundles ?? []
    if (bundles.includes('dsh-latex-studio')) {
      const installed = path.join(profilesDir, name, 'node_modules', 'dsh-latex-studio')
      found.push(name + (fs.existsSync(installed) ? '' : ' (installed copy MISSING)'))
    }
  }
  if (found.length === 0) {
    results.push(bad('profile', 'dsh-latex-studio is not in any profile bundle list under ' + profilesDir))
  } else {
    results.push(ok('profile', 'registered in: ' + found.join(', ')))
  }

  // Is the copy under test the one a profile actually loads? A silent mismatch is
  // how you end up editing the repo while the app runs something older.
  for (const name of wanted) {
    const installed = path.join(profilesDir, name, 'node_modules', 'dsh-latex-studio')
    if (!fs.existsSync(installed)) continue
    const same = path.resolve(installed).toLowerCase() === path.resolve(pkgDir).toLowerCase()
    if (same) {
      results.push(ok('in-sync', 'this directory IS what profile "' + name + '" loads'))
    } else {
      const a = readIfExists(path.join(installed, 'lib', 'index.js'))
      const b = readIfExists(path.join(pkgDir, 'lib', 'index.js'))
      if (a && b && a === b) results.push(ok('in-sync', 'repo and installed lib/index.js are identical'))
      else results.push(warn('in-sync', 'this directory differs from the copy profile "' + name + '" loads (' + installed + '); run tools/install.mjs to deploy'))
    }
    break
  }
  return results
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function checkSkillShadows(pkgDir) {
  const results = []
  const home = dshHome()
  const roots = [
    path.join(home, 'skills'),
    path.join(path.resolve(pkgDir, '..'), '.dsh', 'skills'),
    path.join(path.resolve(pkgDir, '..'), '.agents', 'skills'),
  ]
  const skillNames = (() => {
    try {
      return fs.readdirSync(path.join(pkgDir, 'skills'))
    } catch {
      return []
    }
  })()
  const shadowed = []
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const name of skillNames) {
      if (fs.existsSync(path.join(root, name, 'SKILL.md'))) shadowed.push(path.join(root, name))
    }
  }
  if (shadowed.length > 0) {
    results.push(warn('shadows', 'the plugin registers skills itself, and ' + shadowed.length + ' also exist in a discovery root (one will shadow the other): ' + shadowed.slice(0, 3).join(', ') + (shadowed.length > 3 ? ', …' : '')))
  } else {
    results.push(ok('shadows', 'no discovery root duplicates the plugin-registered skills'))
  }
  return results
}

function checkToolchain(pkgDir) {
  const results = []
  const probe = path.join(pkgDir, 'lib', 'core', 'env.js')
  if (!fs.existsSync(probe)) return [skip('toolchain', 'lib/core/env.js unavailable')]
  const script = `
    const { probeEnv } = await import(${JSON.stringify(pathToFileURL(probe).href)})
    const report = await probeEnv({ rendererOrder: ['poppler', 'miktex-ghostscript', 'mineru-page'] })
    console.log(JSON.stringify({
      latex: report?.latex?.path ?? null,
      version: report?.latex?.version ?? null,
      isMiKTeX: report?.latex?.isMiKTeX === true,
      bibtex: report?.latex?.bibtex ?? null,
      biber: report?.latex?.biber ?? null,
      chktex: report?.latex?.chktex ?? null,
      pdftoppm: report?.poppler?.pdftoppm ?? null,
      pdfinfo: report?.poppler?.pdfinfo ?? null,
      mgs: report?.ghostscript?.mgs ?? null,
      mgsVersion: report?.ghostscript?.version ?? null,
    }))
  `
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', cwd: pkgDir, timeout: 120000 })
  if (run.status !== 0) {
    return [warn('toolchain', 'environment probe failed: ' + String(run.stderr || '').trim().split('\n').slice(-1)[0])]
  }
  let info
  try {
    info = JSON.parse(String(run.stdout).trim().split('\n').slice(-1)[0])
  } catch {
    return [warn('toolchain', 'environment probe returned unparseable output')]
  }
  if (!info.latex) {
    results.push(bad('toolchain', 'no TeX engine found (install MiKTeX: winget install MiKTeX.MiKTeX)'))
  } else {
    results.push(ok('toolchain', 'engine=' + info.latex + (info.version ? ' (' + info.version + ')' : '') + ' isMiKTeX=' + info.isMiKTeX))
  }
  const render = info.pdftoppm || info.mgs
  if (render) results.push(ok('render', 'page-image backend: ' + (info.pdftoppm ? 'poppler (pdftoppm' + (info.pdfinfo ? '+pdfinfo' : '') + ')' : 'MiKTeX ghostscript (mgs' + (info.mgsVersion ? ' ' + info.mgsVersion : '') + ')')))
  else results.push(warn('render', 'no local page-image backend found; visual inspection will degrade to checklist-only'))
  if (info.bibtex || info.biber) results.push(ok('bib', 'bibliography tooling: ' + [info.bibtex ? 'bibtex' : null, info.biber ? 'biber' : null].filter(Boolean).join(', ')))
  else results.push(warn('bib', 'neither bibtex nor biber found; citations will not resolve'))
  if (info.chktex) results.push(ok('chktex', 'optional static checker available (enable with enableChktex)'))
  return results
}

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

const ICON = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL', skip: 'SKIP' }

async function main() {
  const argv = process.argv.slice(2)
  const flag = (name) => {
    const at = argv.indexOf(name)
    return at >= 0 ? argv[at + 1] : null
  }
  const pkgDir = path.resolve(flag('--dir') || PKG_DEFAULT)
  const profile = flag('--profile')
  const asJson = argv.includes('--json')

  if (!fs.existsSync(path.join(pkgDir, 'package.json'))) {
    console.error('not a package directory: ' + pkgDir)
    return 2
  }
  let version = '?'
  try {
    version = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version
  } catch {
    /* reported by checkFiles */
  }

  const results = [
    ...checkFiles(pkgDir),
    ...(await checkLoading(pkgDir)),
    ...checkWiring(pkgDir, profile),
    ...checkSkillShadows(pkgDir),
    ...checkToolchain(pkgDir),
  ]

  const failed = results.filter((r) => r.status === 'fail')
  const warned = results.filter((r) => r.status === 'warn')

  if (asJson) {
    console.log(JSON.stringify({ package: 'dsh-latex-studio', version, dir: pkgDir, results, failed: failed.length, warned: warned.length }, null, 2))
  } else {
    console.log('dsh-latex-studio doctor — v' + version)
    console.log('dir: ' + pkgDir)
    console.log('')
    for (const r of results) console.log('  [' + ICON[r.status] + '] ' + r.name.padEnd(10) + (r.detail ? ' ' + r.detail : ''))
    console.log('')
    console.log(failed.length === 0
      ? (warned.length === 0 ? 'verdict: HEALTHY' : 'verdict: HEALTHY with ' + warned.length + ' warning(s)')
      : 'verdict: ' + failed.length + ' FAILURE(S)')
    if (failed.length > 0) console.log('see docs/HANDOFF.md §14 for the troubleshooting path')
  }
  return failed.length === 0 ? 0 : 1
}

try {
  process.exit(await main())
} catch (error) {
  console.error('doctor crashed: ' + String((error && error.stack) || error))
  process.exit(2)
}
