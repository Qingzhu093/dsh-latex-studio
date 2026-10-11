/**
 * Round state, backups and rollback for the VTO loop.
 *
 * Layout (INTERFACES.md §9):
 *   <proj>/<workDir>/{state.json, build/, auxfiles/, pages/, reports/, backups/rN/}
 * The auxiliary directory is `auxfiles`, never `aux` (Windows reserved name).
 *
 * Pure Node ESM — no DSH imports.
 * @module dsh-latex-studio/core/state
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DEFAULTS } from '../config.js'

/** On-disk state schema version. */
export const STATE_VERSION = 1

/**
 * Advisory repair-loop round budget.
 *
 * This is a product limit, not a deployment parameter, so it is intentionally
 * NOT a config field: nothing in the tool surface enforces it (the loop is
 * model-driven), and a config field that silently does nothing is worse than no
 * field. `isRoundBudgetExhausted()` exposes it so a future enforcing call site
 * has one definition to use; the cap is communicated to the model by
 * `skills/latex-vto-loop/SKILL.md`.
 */
export const DEFAULT_MAX_ROUNDS = 5

/**
 * Sub-directories created under the work dir.
 *
 * `auxfiles` is the directory the compiler actually writes auxiliary files to
 * (see `core/compile.js`). `aux` is deliberately NOT listed: it is a reserved
 * DOS device name on Windows and breaks Copy-Item / Robocopy / Explorer / zip
 * tools. (`workPaths().aux` is kept only as a compatibility accessor.)
 */
export const SUBDIRS = Object.freeze(['build', 'auxfiles', 'pages', 'reports', 'backups'])

/**
 * Absolute paths inside one work dir.
 * @param {string} workDir - absolute (or resolvable) work dir.
 * @returns {{root: string, state: string, build: string, aux: string, pages: string, reports: string, backups: string}}
 */
export function workPaths(workDir) {
  const root = path.resolve(String(workDir))
  return {
    root,
    state: path.join(root, 'state.json'),
    build: path.join(root, 'build'),
    aux: path.join(root, 'aux'),
    pages: path.join(root, 'pages'),
    reports: path.join(root, 'reports'),
    backups: path.join(root, 'backups'),
  }
}

/**
 * Resolve a config `workDir` against a project directory.
 *
 * The name MUST be a plain relative directory. An absolute path or a `..`
 * escape is rejected by falling back to the default, because this value reaches
 * `ensureDirs()`, `writeAtomic()` and (through `compile --clean`) an
 * `rmSync(..., {recursive: true})`. `vto_start`/`vto_fix` also accept it as a
 * tool argument, so without this guard a single call could create or delete
 * directories anywhere the process can write.
 *
 * @param {string} projectDir - project root.
 * @param {string} [workDirName] - configured work dir name.
 * @returns {string} absolute work dir, always inside `projectDir`.
 */
export function resolveWorkDir(projectDir, workDirName) {
  const fallback = path.resolve(String(projectDir), '.latex-studio')
  if (typeof workDirName !== 'string' || workDirName.trim() === '') return fallback
  const name = workDirName.trim()
  if (path.isAbsolute(name) || /^[A-Za-z]:/.test(name) || name.startsWith('\\\\') || name.startsWith('//')) {
    return fallback
  }
  const segments = name.split(/[\\/]+/).filter((part) => part !== '' && part !== '.')
  if (segments.length === 0 || segments.some((part) => part === '..')) return fallback
  const resolved = path.resolve(String(projectDir), ...segments)
  const containment = path.relative(path.resolve(String(projectDir)), resolved)
  if (containment === '' || containment.startsWith('..') || path.isAbsolute(containment)) return fallback
  return resolved
}

/**
 * Create the work dir skeleton (idempotent).
 * @param {string} workDir - work dir.
 * @returns {string} the work dir root.
 */
export function ensureDirs(workDir) {
  const paths = workPaths(workDir)
  fs.mkdirSync(paths.root, { recursive: true })
  for (const sub of SUBDIRS) fs.mkdirSync(path.join(paths.root, sub), { recursive: true })
  return paths.root
}

/** Atomically write text (tmp + rename in the same directory). */
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, file)
  return file
}

/** sha256 of a string. */
function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex')
}

/**
 * Coerce a numeric option to a positive number, treating null/undefined/0/'' as "absent".
 * (`Number(null) === 0` is finite, so a naive check would turn "no budget" into 0.)
 * @param {unknown} value - candidate.
 * @returns {number|null} positive number or null.
 */
function positiveOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

/**
 * Build a fresh loop state.
 * @param {object} input - seed data.
 * @param {string} input.dir - project root.
 * @param {string} [input.workDir] - work dir name or absolute path.
 * @param {string} [input.entry] - entry tex file.
 * @param {number|null} [input.pageBudget] - target page count.
 * @param {string} [input.template] - template id.
 * @param {string} [input.columnType] - 'single' | 'double'.
 * @param {string} [input.uploadScope] - upload scope.
 * @param {number} [input.maxRounds] - round budget (defaults to {@link DEFAULT_MAX_ROUNDS}).
 * @returns {object} state record.
 */
export function newState(input = {}) {
  const dir = path.resolve(String(input.dir ?? '.'))
  const workDir = resolveWorkDir(dir, input.workDir)
  const now = new Date().toISOString()
  return {
    version: STATE_VERSION,
    createdAt: now,
    updatedAt: now,
    dir,
    workDir,
    workDirName: input.workDir ?? '.latex-studio',
    entry: input.entry ?? null,
    pageBudget: positiveOrNull(input.pageBudget),
    template: input.template ?? null,
    columnType: input.columnType === 'double' ? 'double' : 'single',
    uploadScope: input.uploadScope ?? DEFAULTS.uploadScope,
    maxRounds: positiveOrNull(input.maxRounds) ?? DEFAULT_MAX_ROUNDS,
    round: 0,
    status: 'initialized',
    baseline: null,
    history: [],
  }
}

/**
 * Load `state.json` from a work dir.
 * @param {string} workDir - work dir.
 * @returns {object|null} state, or null when absent/unreadable.
 */
export function loadState(workDir) {
  return loadStateSafe(workDir).state
}

/**
 * Load `state.json` without throwing, reporting *why* it is missing.
 * @param {string} workDir - work dir.
 * @returns {{ok: boolean, state: object|null, path: string, error: string|null}}
 */
export function loadStateSafe(workDir) {
  const paths = workPaths(workDir)
  try {
    const text = fs.readFileSync(paths.state, 'utf8')
    const state = JSON.parse(text)
    if (!state || typeof state !== 'object') {
      return { ok: false, state: null, path: paths.state, error: 'state.json 不是对象' }
    }
    return { ok: true, state, path: paths.state, error: null }
  } catch (error) {
    const code = error && error.code ? error.code : null
    if (code === 'ENOENT') return { ok: false, state: null, path: paths.state, error: null }
    return { ok: false, state: null, path: paths.state, error: String((error && error.message) || error) }
  }
}

/**
 * Persist state atomically (stamps `updatedAt`).
 * @param {string} workDir - work dir.
 * @param {object} state - state record.
 * @returns {string} path of the written state.json.
 */
export function saveState(workDir, state) {
  const paths = workPaths(workDir)
  ensureDirs(workDir)
  const next = { ...state, version: state.version ?? STATE_VERSION, updatedAt: new Date().toISOString() }
  return writeAtomic(paths.state, JSON.stringify(next, null, 2) + '\n')
}

/**
 * Advance one round. Pure: returns a new state, the input is not mutated.
 * @param {object} state - current state.
 * @param {object} [meta] - optional round metadata.
 * @returns {object} next state.
 */
export function nextRound(state, meta = {}) {
  const round = Number(state?.round ?? 0) + 1
  const history = Array.isArray(state?.history) ? state.history : []
  return {
    ...state,
    round,
    status: 'in_round',
    updatedAt: new Date().toISOString(),
    history: [...history, { round, startedAt: new Date().toISOString(), ...meta }],
  }
}

/**
 * Whether the round budget is used up.
 * @param {object} state - state record.
 * @returns {boolean} true when no further round should be started.
 */
export function isRoundBudgetExhausted(state) {
  const max = Number(state?.maxRounds)
  const limit = Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX_ROUNDS
  return Number(state?.round ?? 0) >= limit
}

/** Resolve one caller-supplied file against the project root. */
function resolveTarget(projectRoot, file) {
  const raw = String(file)
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectRoot, raw)
}

/**
 * Copy files into `backups/r<round>/` and write a manifest.
 *
 * Files that do not exist are recorded with `existed: false` so that
 * {@link rollback} can delete files a fix created.
 * @param {string} workDir - work dir.
 * @param {number} round - round number.
 * @param {string[]} files - absolute or project-root-relative paths.
 * @param {{projectRoot?: string}} [options] - overrides.
 * @returns {string[]} absolute paths of the backup copies actually written.
 */
export function backupFiles(workDir, round, files, options = {}) {
  if (!Array.isArray(files) || files.length === 0) return []
  const root = workPaths(ensureDirs(workDir)).root
  const projectRoot = path.resolve(String(options.projectRoot ?? path.dirname(root)))
  const dest = path.join(root, 'backups', 'r' + round)
  fs.mkdirSync(dest, { recursive: true })

  const manifestFile = path.join(dest, 'manifest.json')
  const manifest = readManifest(manifestFile)
  const written = []

  for (const file of files) {
    const original = resolveTarget(projectRoot, file)
    let rel = path.relative(projectRoot, original)
    if (rel.startsWith('..') || path.isAbsolute(rel)) rel = path.join('_external', path.basename(original))
    const entry = { original, relative: rel, backup: null, existed: false, sha256: null, bytes: null }
    try {
      const stat = fs.statSync(original)
      if (stat.isFile()) {
        const backup = path.join(dest, rel)
        fs.mkdirSync(path.dirname(backup), { recursive: true })
        const data = fs.readFileSync(original)
        fs.writeFileSync(backup, data)
        entry.backup = backup
        entry.existed = true
        entry.sha256 = createHash('sha256').update(data).digest('hex')
        entry.bytes = data.byteLength
        written.push(backup)
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error
    }
    // A repeated backup of the same path in the same round keeps the FIRST copy.
    const idx = manifest.entries.findIndex((e) => e.original === entry.original)
    if (idx >= 0) {
      if (!manifest.entries[idx].existed && entry.existed) manifest.entries[idx] = entry
    } else {
      manifest.entries.push(entry)
    }
  }

  manifest.round = round
  manifest.at = new Date().toISOString()
  writeAtomic(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
  return written
}

/** Read a backup manifest, tolerating absence and corruption. */
function readManifest(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed && Array.isArray(parsed.entries)) return parsed
  } catch {
    /* missing or corrupt manifest: start a fresh one */
  }
  return { round: null, at: null, entries: [] }
}

/**
 * Read the manifest of one round without restoring anything.
 * @param {string} workDir - work dir.
 * @param {number} round - round number.
 * @returns {{round: number|null, at: string|null, entries: object[]}}
 */
export function readBackupManifest(workDir, round) {
  const root = workPaths(workDir).root
  return readManifest(path.join(root, 'backups', 'r' + round, 'manifest.json'))
}

/**
 * Restore every file recorded for one round.
 *
 * Files backed up are copied back; files a fix created (`existed: false`) are
 * deleted. The manifest is marked `rolledBack` so a second rollback is a no-op.
 * @param {string} workDir - work dir.
 * @param {number} round - round number.
 * @returns {string[]} original paths restored or removed.
 */
export function rollback(workDir, round) {
  const root = workPaths(workDir).root
  const dir = path.join(root, 'backups', 'r' + round)
  const manifestFile = path.join(dir, 'manifest.json')
  const manifest = readManifest(manifestFile)
  if (!manifest.entries || manifest.entries.length === 0) return []

  const affected = []
  for (const entry of manifest.entries) {
    if (!entry || typeof entry.original !== 'string') continue
    if (entry.existed && entry.backup && fs.existsSync(entry.backup)) {
      fs.mkdirSync(path.dirname(entry.original), { recursive: true })
      fs.copyFileSync(entry.backup, entry.original)
      affected.push(entry.original)
    } else if (!entry.existed && fs.existsSync(entry.original)) {
      fs.rmSync(entry.original, { force: true })
      affected.push(entry.original)
    }
  }
  manifest.rolledBackAt = new Date().toISOString()
  writeAtomic(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
  return affected
}

/**
 * Append one round record to `reports/round-<n>.record.json`.
 * @param {string} workDir - work dir.
 * @param {number} round - round number.
 * @param {object} payload - round data (must be JSON-serializable).
 * @returns {string} path of the written record.
 */
export function recordRound(workDir, round, payload = {}) {
  const paths = workPaths(ensureDirs(workDir))
  const file = path.join(paths.reports, 'round-' + round + '.record.json')
  const record = { round, at: new Date().toISOString(), ...payload }
  return writeAtomic(file, JSON.stringify(record, null, 2) + '\n')
}

/**
 * Load one round record.
 * @param {string} workDir - work dir.
 * @param {number} round - round number.
 * @returns {object|null} record or null.
 */
export function loadRoundRecord(workDir, round) {
  const paths = workPaths(workDir)
  try {
    return JSON.parse(fs.readFileSync(path.join(paths.reports, 'round-' + round + '.record.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Most recent round record that exists (for regression comparison).
 * @param {string} workDir - work dir.
 * @param {number} round - round to start looking back from (inclusive).
 * @returns {object|null} record or null.
 */
export function latestRoundRecord(workDir, round) {
  for (let i = Number(round) || 0; i >= 1; i--) {
    const record = loadRoundRecord(workDir, i)
    if (record) return record
  }
  return null
}
