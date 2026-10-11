#!/usr/bin/env node
/**
 * One-command install/upgrade for this plugin.
 *
 * The manual procedure in docs/HANDOFF.md §11.2 was four steps long and easy to
 * get half-right (pack, edit the profile manifest, copy the tree, remember to
 * verify). This script does the whole thing and then proves it worked, so
 * "installed" means "doctor says HEALTHY", not "I think I copied the files".
 *
 * What it does, in order:
 *   1. `npm pack` the package (honours the `files` whitelist, so `tools/_p0`
 *      research evidence can never leak into a release).
 *   2. Register the dependency + bundle in the target profile's package.json,
 *      after taking a timestamped backup of that manifest.
 *   3. Mirror the packed tree into the profile's node_modules copy.
 *   4. Run tools/doctor.mjs against the deployed copy and report the verdict.
 *
 * It deliberately does NOT run `npm install` inside the profile: the desktop
 * profile is managed by the Electron app, and `dsh plugin add` is documented to
 * hang there. Mirroring the already-packed tree is the path this machine can
 * actually execute.
 *
 * Usage:
 *   node tools/install.mjs                     # pack + install into the default profile
 *   node tools/install.mjs --profile desktop   # pick a profile
 *   node tools/install.mjs --dry-run           # show the plan, change nothing
 *   node tools/install.mjs --no-pack           # reuse the existing tarball
 *
 * Exit code: 0 deployed and healthy, 1 a step failed, 2 bad invocation.
 *
 * @module tools/install
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(HERE, '..')
const PKG_NAME = 'dsh-latex-studio'

const c = {
  dim: (s) => '\u001b[2m' + s + '\u001b[0m',
  bold: (s) => '\u001b[1m' + s + '\u001b[0m',
  green: (s) => '\u001b[32m' + s + '\u001b[0m',
  yellow: (s) => '\u001b[33m' + s + '\u001b[0m',
  red: (s) => '\u001b[31m' + s + '\u001b[0m',
}
const step = (n, text) => console.log(c.bold('[' + n + '] ') + text)
const info = (text) => console.log('    ' + text)
const die = (text) => {
  console.error(c.red('error: ') + text)
  process.exit(1)
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}

/**
 * Run a command, inheriting stdio, and return the exit status.
 *
 * A `.cmd`/`.bat` launcher needs `shell: true` on Node >= 18.20 / 20.12 / 22,
 * which refuses to spawn Windows batch files directly (CVE-2024-27980). The
 * arguments here are all internal literals, never user input.
 */
function run(command, args, options = {}) {
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
  const result = spawnSync(command, args, { stdio: 'inherit', ...options, ...(needsShell ? { shell: true } : {}) })
  if (result.error) die('failed to run ' + command + ': ' + result.error.message)
  return result.status ?? 1
}

/** Locate an `npm` launcher. `npm.cmd` on Windows; the bundled runtime has none. */
function findNpm() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'npm.cmd'),
    path.join(path.dirname(process.execPath), 'npm'),
    'C:\\Program Files\\nodejs\\npm.cmd',
    path.join(os.homedir(), 'nodejs', 'npm.cmd'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (candidate.endsWith('.mjs') || candidate.endsWith('.js')) return { command: process.execPath, prefix: [candidate] }
    if (fs.existsSync(candidate)) return { command: candidate, prefix: [] }
  }
  return null
}

function main() {
  const argv = process.argv.slice(2)
  const flag = (name) => {
    const at = argv.indexOf(name)
    return at >= 0 ? argv[at + 1] : null
  }
  const dryRun = argv.includes('--dry-run')
  const noPack = argv.includes('--no-pack')
  const profileName = flag('--profile') || 'desktop'

  const profileDir = path.join(dshHome(), 'profiles', profileName)
  const manifestPath = path.join(profileDir, 'package.json')
  const installedDir = path.join(profileDir, 'node_modules', PKG_NAME)

  console.log(c.bold(PKG_NAME + ' install') + c.dim('  profile=' + profileName))
  console.log(c.dim('  source : ' + PKG))
  console.log(c.dim('  target : ' + installedDir))
  console.log('')

  const pkg = readJson(path.join(PKG, 'package.json'))
  const version = pkg.version

  // --- preflight ---------------------------------------------------------
  if (!fs.existsSync(profileDir)) {
    die('profile directory not found: ' + profileDir + '\n       create/launch the profile once, or pass --profile <name>')
  }
  if (!fs.existsSync(manifestPath)) die('profile manifest not found: ' + manifestPath)
  if (!pkg.dsh?.bundle?.patch) die('package.json has no dsh.bundle.patch; this is not an installable bundle')

  if (dryRun) {
    console.log(c.yellow('dry run — nothing will change'))
    console.log('  would pack        : ' + PKG_NAME + '-' + version + '.tgz')
    console.log('  would back up     : ' + manifestPath + '.bak-install-<timestamp>')
    console.log('  would register    : dependencies["' + PKG_NAME + '"] + dsh.profile.bundles += "' + PKG_NAME + '"')
    console.log('  would mirror into : ' + installedDir)
    console.log('  would verify      : node tools/doctor.mjs --dir ' + installedDir)
    return 0
  }

  // --- 1. pack -----------------------------------------------------------
  let tarball = path.join(PKG, PKG_NAME + '-' + version + '.tgz')
  if (noPack) {
    if (!fs.existsSync(tarball)) die('--no-pack given but ' + tarball + ' does not exist')
    step(1, 'reusing existing tarball')
    info(path.basename(tarball))
  } else {
    step(1, 'packing (honours the files whitelist, so tools/_p0 stays out)')
    const npm = findNpm()
    if (!npm) die('could not find npm; pass --no-pack with a prebuilt tarball')
    // A stale tarball would silently ship old code; remove it first.
    for (const stale of fs.readdirSync(PKG).filter((f) => f.startsWith(PKG_NAME + '-') && f.endsWith('.tgz'))) {
      fs.rmSync(path.join(PKG, stale), { force: true })
    }
    // A broken ~/.npmrc proxy is a known failure on this machine; a clean
    // userconfig avoids hanging on it.
    const cleanRc = path.join(os.tmpdir(), 'dsh-install-clean-npmrc')
    if (!fs.existsSync(cleanRc)) fs.writeFileSync(cleanRc, '')
    const status = run(npm.command, [...npm.prefix, 'pack'], { cwd: PKG, env: { ...process.env, npm_config_userconfig: cleanRc } })
    if (status !== 0) die('npm pack failed with exit ' + status)
    if (!fs.existsSync(tarball)) die('npm pack produced no ' + path.basename(tarball))
    info(path.basename(tarball) + '  ' + fs.statSync(tarball).size.toLocaleString() + ' B')
  }

  // --- 2. register in the profile manifest -------------------------------
  step(2, 'registering the bundle in the profile manifest')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = manifestPath + '.bak-install-' + stamp
  fs.copyFileSync(manifestPath, backupPath)
  info('backup: ' + path.basename(backupPath))

  const manifest = readJson(manifestPath)
  manifest.dependencies = manifest.dependencies || {}
  manifest.dependencies[PKG_NAME] = 'file:' + tarball.replace(/\\/g, '/')
  manifest.dsh = manifest.dsh || {}
  manifest.dsh.profile = manifest.dsh.profile || {}
  const bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []
  if (!bundles.includes(PKG_NAME)) bundles.push(PKG_NAME)
  manifest.dsh.profile.bundles = bundles
  writeJson(manifestPath, manifest)
  info('dependencies["' + PKG_NAME + '"] = file:' + path.basename(tarball))
  info('dsh.profile.bundles = [' + bundles.length + ' entries]')

  // --- 3. mirror the packed tree -----------------------------------------
  step(3, 'mirroring the packed tree into node_modules')
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-install-stage-'))
  try {
    // Extract with tar (available on Windows 10+ and every POSIX shell).
    const extract = spawnSync('tar', ['-xzf', tarball, '-C', stage], { encoding: 'utf8' })
    if (extract.status !== 0) die('tar extraction failed: ' + String(extract.stderr || '').trim())
    const staged = path.join(stage, 'package')
    if (!fs.existsSync(path.join(staged, 'lib', 'index.js'))) die('tarball does not contain lib/index.js')

    if (fs.existsSync(installedDir)) {
      const preserved = path.join(installedDir, 'node_modules')
      const hadUserModules = fs.existsSync(preserved)
      // Mirror without deleting a peer `node_modules` that may have been linked in.
      const args = ['/MIR', staged, installedDir, '/XD', 'node_modules', '/NFL', '/NDL', '/NJH', '/NJS', '/NP']
      const copy = spawnSync('robocopy', args, { encoding: 'utf8' })
      // robocopy exit codes 0-7 are success variants; >=8 is a real failure.
      if (copy.error || (copy.status ?? 0) >= 8) {
        die('robocopy failed (exit ' + (copy.status ?? 'spawn-error') + ')' + (hadUserModules ? '; note node_modules was preserved' : ''))
      }
      info('mirrored into existing ' + path.basename(installedDir) + ' (node_modules preserved)')
    } else {
      fs.mkdirSync(path.dirname(installedDir), { recursive: true })
      fs.cpSync(staged, installedDir, { recursive: true })
      info('created ' + installedDir)
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true })
  }

  // --- 4. verify ---------------------------------------------------------
  step(4, 'verifying the deployed copy')
  const doctorPath = path.join(installedDir, 'tools', 'doctor.mjs')
  if (!fs.existsSync(doctorPath)) {
    // Shipping doctor.mjs is what makes "installed" a claim we can check. If a
    // future packaging change drops it, say so instead of implying success.
    console.log(c.yellow('    tools/doctor.mjs is not in the tarball; cannot verify the deployed copy'))
    console.log(c.yellow('    add it to package.json "files", then re-run'))
  } else {
    const status = run(process.execPath, [doctorPath, '--dir', installedDir, '--profile', profileName], { cwd: installedDir })
    if (status !== 0) {
      console.error('')
      console.error(c.red('deployed, but verification failed.'))
      console.error('restore the manifest with: copy "' + backupPath + '" over "' + manifestPath + '"')
      process.exit(1)
    }
  }

  console.log('')
  console.log(c.green('done.') + ' ' + PKG_NAME + '@' + version + ' deployed to profile "' + profileName + '".')
  console.log(c.yellow('restart DSH (or open a new session) for the new build to be loaded.'))
  return 0
}

process.exit(main())
