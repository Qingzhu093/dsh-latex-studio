#!/usr/bin/env node
/**
 * Packaging verifier: "is the tarball we would ship actually installable?"
 *
 * WHY THIS IS SEPARATE FROM tools/doctor.mjs
 * `doctor` inspects a DIRECTORY that already exists. It cannot catch the failures
 * that only appear after `npm pack`: a file missing from the `files` whitelist, an
 * export pointing at an unshipped path, a client bundle that did not make it into
 * the tarball, or a runtime dependency creeping into a package that promises zero.
 * Those are exactly the failures a user hits on `dsh plugin add <tarball>` — after
 * the release, on someone else's machine.
 *
 * What it does:
 *   1. `npm pack --json` into a temp dir and keep the reported file list + sizes.
 *   2. Assert the whitelist: every packed file is expected, and nothing forbidden
 *      (`docs/`, `tools/_p0/`, `node_modules/`, `*.tgz`) leaked in.
 *   3. Assert the required entries: host entry, browser half, data assets, skills,
 *      patch layer, display metadata, icon, notices.
 *   4. Extract the tarball and load the HOST half from the extracted copy: `apply()`
 *      must register the 10 tools and the 3 skills, with no runtime dependency.
 *   5. Assert the BROWSER half is the lazy-CJS factory the client module system
 *      requires and that every `exports` target exists inside the tarball.
 *   6. Print the tarball's size and sha256 so a release can be quoted exactly.
 *
 * Usage:
 *   node tools/verify-package.mjs             # pack into a temp dir, verify, clean up
 *   node tools/verify-package.mjs --json      # machine-readable result
 *   node tools/verify-package.mjs --keep      # keep the tarball + extracted tree
 *   node tools/verify-package.mjs --tgz <f>   # verify an existing tarball (no pack)
 *
 * Exit code: 0 every assertion passed, 1 a check failed, 2 the runner itself failed.
 *
 * @module tools/verify-package
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(HERE, '..')
const argv = process.argv.slice(2)
const flag = (name) => {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}
const asJson = argv.includes('--json')
const keep = argv.includes('--keep')

const results = []
const ok = (name, detail = '') => results.push({ name, status: 'ok', detail })
const bad = (name, detail = '') => results.push({ name, status: 'fail', detail })

/** Every entry the tarball is allowed to carry (mirrors package.json "files"). */
const ALLOWED = [
  /^package\.json$/,
  /^README\.md$/,
  /^LICENSE$/,
  /^THIRD_PARTY_NOTICES\.md$/,
  /^cordis\.patch\.yml$/,
  /^icon\.svg$/,
  /^lib\/.*/,
  /^locale\/[^/]+\.json$/,
  /^skills\/[^/]+\/SKILL\.md$/,
  /^test\/.*/,
  /^tools\/(doctor|install|build-preview|verify-package|verify-pdf-read|vendor-paperfit-specs)\.mjs$/,
]

/** Entries the tarball must carry for the plugin to load and behave. */
const REQUIRED = [
  'lib/index.js',
  'lib/client.js',
  'lib/config.js',
  'lib/core/skillpack.js',
  'lib/core/compile.js',
  'lib/core/vto.js'.replace('core/vto', 'tools/vto'),
  'lib/tools/daily.js',
  'lib/data/vto_taxonomy.json',
  'lib/data/layout_rules.json',
  'lib/data/templates.json',
  'lib/data/content_boundaries.json',
  'lib/data/writing_rules.json',
  'lib/data/agent_roles.json',
  'skills/latex-daily/SKILL.md',
  'skills/latex-vto-loop/SKILL.md',
  'skills/latex-fix-catalog/SKILL.md',
  'locale/en.json',
  'locale/zh.json',
  'icon.svg',
  'cordis.patch.yml',
  'README.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
]

/** Forbidden paths: never in a published artifact. */
const FORBIDDEN = [
  { test: (rel) => rel.startsWith('docs/'), why: 'docs/ is maintainer material and is not published' },
  { test: (rel) => rel.startsWith('tools/_p0/'), why: 'research probes are local evidence, not package content' },
  { test: (rel) => rel.includes('node_modules/'), why: 'dependencies must never be vendored into the tarball' },
  { test: (rel) => rel.endsWith('.tgz'), why: 'a nested tarball is never package content' },
]

const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', ...options })

/** Pack the package and return { tgz, files: [{ path, size }] }. */
function pack(destination) {
  if (fs.existsSync(npmCli)) {
    const packed = run(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', destination], { cwd: PKG })
    if (packed.status !== 0) throw new Error('npm pack failed: ' + (packed.stderr || packed.stdout || '').slice(0, 400))
    const report = JSON.parse(packed.stdout.slice(packed.stdout.indexOf('[')))
    const entry = report[0]
    return { tgz: path.join(destination, entry.filename), files: entry.files.map((file) => ({ path: file.path, size: file.size })) }
  }
  const packed = run('npm.cmd', ['pack', '--json', '--pack-destination', destination], { cwd: PKG, shell: true })
  if (packed.status !== 0) throw new Error('npm pack failed: ' + (packed.stderr || packed.stdout || '').slice(0, 400))
  const report = JSON.parse(packed.stdout.slice(packed.stdout.indexOf('[')))
  const entry = report[0]
  return { tgz: path.join(destination, entry.filename), files: entry.files.map((file) => ({ path: file.path, size: file.size })) }
}

/** List the entries inside an existing tarball, as paths relative to package/. */
function listTarball(tgz) {
  const listed = run('tar', ['-tf', tgz], { shell: false })
  if (listed.status !== 0) throw new Error('tar -tf failed: ' + (listed.stderr || '').slice(0, 300))
  return listed.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.replace(/\\/g, '/'))
    .filter((line) => line.startsWith('package/'))
    .map((line) => line.slice('package/'.length))
}

/**
 * Give the extracted copy the peer dependencies the Host would provide.
 *
 * The tarball intentionally ships no `node_modules` and declares Schemastery,
 * dsh-tools and cordis as peers: outside a profile, `import` therefore fails with
 * ERR_MODULE_NOT_FOUND — which says nothing about the package. Link this repo's
 * dev copies so the shipped files are executed exactly as a Host would run them.
 */
function linkPeers(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const peers = Object.keys({ ...(manifest.peerDependencies ?? {}), ...(manifest.devDependencies ?? {}) }).filter((name) => name.startsWith('@deepseek-ai/'))
  const linked = []
  const missing = []
  for (const name of peers) {
    const source = path.join(PKG, 'node_modules', name)
    if (!fs.existsSync(source)) {
      missing.push(name)
      continue
    }
    const target = path.join(root, 'node_modules', name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.symlinkSync(source, target, 'junction')
    linked.push(name)
  }
  if (linked.length === 0) bad('peers', 'no peer copies found in this checkout; cannot execute the shipped host half')
  else ok('peers', linked.length + ' peer(s) linked for execution' + (missing.length > 0 ? '; not installed locally: ' + missing.join(', ') : ''))
}

function extract(tgz, destination) {
  fs.mkdirSync(destination, { recursive: true })
  const extracted = run('tar', ['-xf', tgz, '-C', destination])
  if (extracted.status !== 0) throw new Error('tar -xf failed: ' + (extracted.stderr || '').slice(0, 300))
  return path.join(destination, 'package')
}

/** The host half must load from the extracted copy and register everything. */
async function checkHostHalf(root) {
  const entry = path.join(root, 'lib', 'index.js')
  let mod
  try {
    mod = await import(pathToFileURL(entry).href)
  } catch (error) {
    return bad('hostHalf', 'import failed: ' + String((error && error.message) || error))
  }
  const tools = []
  const skills = []
  const warnings = []
  const ctx = {
    tools: { register: (tool) => { tools.push(tool.name); return () => {} } },
    get: (name) => (name === 'skills' ? { register: (skill) => { skills.push(skill.name); return () => {} } } : undefined),
    logger: { info() {}, warn: (...args) => warnings.push(args.join(' ')) },
    inject: () => {},
  }
  let outcome
  try {
    const sample = typeof mod.Config === 'function' ? unwrapVolatile(mod.Config({})) : {}
    outcome = mod.apply(ctx, sample)
  } catch (error) {
    return bad('hostHalf', 'apply() threw: ' + String((error && error.message) || error))
  }
  const expectedTools = ['latex_doctor', 'latex_build', 'latex_lint', 'bib_tool', 'vto_start', 'vto_inspect', 'vto_fix', 'vto_verify', 'vto_report', 'vto_rollback']
  const missingTools = expectedTools.filter((name) => !tools.includes(name))
  if (missingTools.length > 0) bad('tools', 'missing: ' + missingTools.join(', ') + ' (registered: ' + tools.join(', ') + ')')
  else ok('tools', tools.length + ' tools registered')
  if (skills.length !== 3) bad('skills', 'expected 3 skills, registered ' + skills.length + ' (' + skills.join(', ') + ')')
  else ok('skills', '3 skills registered: ' + skills.join(', '))
  const fatal = warnings.filter((line) => !/volatile/.test(line))
  if (fatal.length > 0) bad('applyWarnings', fatal.join(' | '))
  else ok('applyWarnings', 'no unexpected load warnings')
  if (outcome?.failed?.length > 0) bad('subsystems', JSON.stringify(outcome.failed))
  return undefined
}

/** Unwrap cosmokit Volatile references (the schema marks every field volatile). */
function unwrapVolatile(value) {
  const WRITE = Symbol.for('cosmokit.volatile.write')
  if (typeof value === 'object' && value !== null && WRITE in value) return unwrapVolatile(value.get())
  if (Array.isArray(value)) return value.map(unwrapVolatile)
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, unwrapVolatile(child)]))
  }
  return value
}

/** The browser half must be exactly what the client module system serves. */
function checkClientHalf(root) {
  const file = path.join(root, 'lib', 'client.js')
  if (!fs.existsSync(file)) return bad('clientHalf', 'lib/client.js is not in the tarball')
  const source = fs.readFileSync(file, 'utf8')
  const problems = []
  if (!/window\.__ModuleLoader__\.load\(/.test(source)) problems.push('not a lazy-CJS factory')
  if (!/id:\s*"dsh-latex-studio"/.test(source)) problems.push('unexpected module id')
  for (const required of source.matchAll(/require\("([^"]+)"\)/g)) {
    if (required[1] !== 'react' && required[1] !== 'react/jsx-runtime') problems.push('requires ' + required[1])
  }
  if (!source.includes('"plugins.bundle.config"')) problems.push('does not register the bundle config slot')
  if (!source.includes('"plugins.row.config"')) problems.push('does not register the row config slot')
  if (problems.length > 0) bad('clientHalf', problems.join('; '))
  else ok('clientHalf', 'lazy-CJS factory, react only, both config slots')
  return undefined
}

/** Manifest promises: zero runtime deps, both manifests, every export on disk. */
function checkManifest(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  if (manifest.dependencies !== undefined && Object.keys(manifest.dependencies).length > 0) {
    bad('noRuntimeDeps', 'dependencies must stay empty, found: ' + Object.keys(manifest.dependencies).join(', '))
  } else {
    ok('noRuntimeDeps', 'zero runtime dependencies')
  }
  if (manifest?.dsh?.bundle?.patch !== './cordis.patch.yml') bad('bundleManifest', 'dsh.bundle.patch must be ./cordis.patch.yml')
  else ok('bundleManifest', 'dsh.bundle.patch present')
  if (manifest?.dsh?.client?.platform !== 'web') bad('clientManifest', 'dsh.client.platform must be "web"')
  else ok('clientManifest', 'dsh.client (web) declared, inject: ' + JSON.stringify(manifest.dsh.client.inject ?? []))

  const missing = []
  for (const [key, target] of Object.entries(manifest.exports ?? {})) {
    const resolved = typeof target === 'string' ? target : target?.default
    if (resolved === undefined) {
      missing.push(key + ' (no default)')
      continue
    }
    if (resolved.includes('*')) continue
    if (!fs.existsSync(path.join(root, resolved.replace(/^\.\//, '')))) missing.push(key + ' -> ' + resolved)
  }
  if (missing.length > 0) bad('exports', 'export targets missing from the tarball: ' + missing.join(', '))
  else ok('exports', Object.keys(manifest.exports ?? {}).length + ' export targets exist in the tarball')

  const icon = manifest.icon
  if (typeof icon !== 'string') return bad('icon', 'package.json has no icon field')
  const iconFile = path.join(root, icon.replace(/^\.\//, ''))
  if (!fs.existsSync(iconFile)) return bad('icon', 'icon file missing: ' + icon)
  const size = fs.statSync(iconFile).size
  if (size > 256 * 1024) return bad('icon', 'icon exceeds 256 KiB (' + size + ' bytes)')
  ok('icon', icon + ' (' + size + ' bytes)')
  return undefined
}

async function main() {
  const started = Date.now()
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-latex-studio-verify-'))
  const existing = flag('--tgz')

  let tgz
  let files
  try {
    if (existing !== undefined) {
      tgz = path.resolve(existing)
      if (!fs.existsSync(tgz)) throw new Error('tarball not found: ' + tgz)
      files = listTarball(tgz).map((rel) => ({ path: rel, size: null }))
    } else {
      const packed = pack(tempRoot)
      tgz = packed.tgz
      files = packed.files
    }
  } catch (error) {
    console.error('verify-package: ' + String((error && error.message) || error))
    return 2
  }

  // 1) whitelist
  const unexpected = files.map((file) => 'package/' + file.path.replace(/\\/g, '/')).filter((entry) => {
    const rel = entry.slice('package/'.length)
    return !ALLOWED.some((pattern) => pattern.test(rel))
  })
  if (unexpected.length > 0) bad('whitelist', 'unexpected entries: ' + unexpected.slice(0, 8).join(', '))
  else ok('whitelist', files.length + ' entries, all inside the declared whitelist')

  const forbidden = []
  for (const file of files) {
    const rel = file.path.replace(/\\/g, '/')
    for (const rule of FORBIDDEN) if (rule.test(rel)) forbidden.push(rel + ' (' + rule.why + ')')
  }
  if (forbidden.length > 0) bad('forbidden', forbidden.slice(0, 6).join('; '))
  else ok('forbidden', 'no docs/, probes, node_modules or nested tarballs')

  // 2) required entries
  const packed = new Set(files.map((file) => file.path.replace(/\\/g, '/')))
  const missing = REQUIRED.filter((rel) => !packed.has(rel))
  if (missing.length > 0) bad('required', 'missing from the tarball: ' + missing.join(', '))
  else ok('required', REQUIRED.length + ' required entries present')

  // 3) extracted copy: host + browser halves + manifest promises
  const extracted = extract(tgz, path.join(tempRoot, 'extracted'))
  linkPeers(extracted)
  await checkHostHalf(extracted)
  checkClientHalf(extracted)
  checkManifest(extracted)

  // 4) release identity
  const bytes = fs.statSync(tgz).size
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(tgz)).digest('hex')
  ok('artifact', path.basename(tgz) + ' · ' + bytes + ' bytes · sha256 ' + sha256.slice(0, 16) + '…')

  const failed = results.filter((result) => result.status === 'fail')
  if (!keep) fs.rmSync(tempRoot, { recursive: true, force: true })

  if (asJson) {
    console.log(JSON.stringify({ tgz, bytes, sha256, keep: keep ? tempRoot : null, results, failed: failed.length, durationMs: Date.now() - started }, null, 2))
  } else {
    console.log('dsh-latex-studio package verification')
    console.log('tarball: ' + tgz)
    console.log('')
    for (const result of results) console.log('  [' + (result.status === 'ok' ? 'OK  ' : 'FAIL') + '] ' + result.name.padEnd(14) + (result.detail ? ' ' + result.detail : ''))
    console.log('')
    console.log(failed.length === 0 ? 'verdict: PACKAGE OK' : 'verdict: ' + failed.length + ' FAILURE(S)')
    if (failed.length === 0 && keep) console.log('kept: ' + tempRoot)
  }
  return failed.length === 0 ? 0 : 1
}

process.exit(await main())
