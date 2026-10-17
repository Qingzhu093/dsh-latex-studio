/**
 * Config-contract guard.
 *
 * The official plugin guide ("插件配置") makes the exported Schemastery `Config`
 * the single source of truth: Cordis validates the patch config and fills every
 * omitted field from the schema before `apply` runs. A field that is not
 * declared is therefore DROPPED before the plugin ever sees it — a silent
 * feature loss (regression this file exists to prevent: the switch
 * `pageBudget` was once undeclared, so `pageBudget: 9` never reached the code).
 *
 * A patch also REPLACES the whole `config` object instead of deep-merging it
 * ("打包与安装插件"). The 0.1.0 design therefore duplicated all defaults in
 * `cordis.patch.yml` as well, in lockstep with the schema. That third copy was
 * the project's #1 footgun: a user overriding one field in their profile patch
 * silently dropped the other 19, because the bundle layer's copy was replaced
 * as a whole. Since the schema already fills every omitted field, the bundle
 * layer does not need a `config` block at all — and this file now asserts that
 * it has none, so the drift class cannot come back.
 *
 * Schemastery object semantics observed on 3.18.4: a field whose value resolves
 * to `null`/`undefined` is OMITTED from the validated object (the key is
 * absent, not present-with-null). `apply` therefore runs the validated config
 * through `normalizeConfig()`, which restores the DEFAULTS value.
 *
 * 0.4.0 adds a second contract: every field is `.volatile()`, because the
 * settings service only exposes volatile fields to the Plugins page form
 * (`@deepseek-ai/dsh-settings`: "表单只展示活动且可唯一定位的 profile 条目中的
 * volatile 字段"). Two consequences this file pins down:
 *   * the validated config holds Volatile REFERENCES, so every assertion here
 *     must unwrap them with `configSnapshot()`;
 *   * the plugin may only read config through `liveConfig()`, which re-reads on
 *     every property access — a one-shot snapshot would ignore saved edits
 *     until a full plugin reload.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULTS, normalizeConfig, configSnapshot, isVolatileRef, liveConfig, markVolatile } from '../lib/config.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const defaultKeys = Object.keys(DEFAULTS).sort()
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

let Config = null
let schemaError = ''
try {
  Config = (await import('../lib/index.js')).Config
} catch (error) {
  schemaError = String(error?.message ?? error)
}
const skip = Config ? false : 'Config schema unavailable (' + schemaError.slice(0, 80) + ')'

/** Unwrap Volatile references the way the plugin does. */
function plain(value) {
  return configSnapshot(value)
}

/** Every DEFAULTS key with a representative non-null value (so nullable ones materialise). */
function fullSample() {
  const sample = {}
  for (const [key, value] of Object.entries(DEFAULTS)) sample[key] = value === null ? 9 : value
  sample.pageBudget = 9
  return sample
}

/** A Volatile reference with the same protocol cosmokit creates. */
function volatileRef(initial) {
  let current = initial
  return Object.freeze({
    get: () => current,
    [VOLATILE_WRITE]: (next) => {
      current = next
    },
  })
}

test('config: the bundle patch inserts the row and carries NO config block', () => {
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  const body = patch
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')
  assert.match(body, /id:\s*latex-studio/, 'the patch must still insert the latex-studio row')
  assert.match(body, /name:\s*'?dsh-latex-studio'?/, 'the inserted row must reference the package name')
  assert.doesNotMatch(
    body,
    /^\s*config:/m,
    'the bundle patch must not duplicate defaults: a patch replaces the whole config, so a copy here silently drops user overrides',
  )
})

test('config: the schema accepts every DEFAULTS key (no field can be silently stripped)', { skip }, () => {
  const validated = plain(Config(fullSample()))
  assert.deepEqual(Object.keys(validated).sort(), defaultKeys, 'schema dropped or invented a field')
})

test('config: schema defaults match DEFAULTS for every non-null field', { skip }, () => {
  const validated = plain(Config({}))
  for (const key of defaultKeys) {
    if (DEFAULTS[key] === null) continue
    assert.deepEqual(validated[key], DEFAULTS[key], 'schema default for "' + key + '" differs from DEFAULTS')
  }
})

test('config: every declared field is volatile on every deployment', { skip }, async () => {
  const { VOLATILE_CONFIG_SUPPORTED, SCHEMA_SOURCE } = await import('../lib/index.js')
  assert.equal(VOLATILE_CONFIG_SUPPORTED, true, 'the bundled fallback must guarantee volatile support even on an old host copy')
  assert.ok(['host', 'vendored'].includes(SCHEMA_SOURCE), 'unexpected schema source: ' + SCHEMA_SOURCE)
  const validated = Config(fullSample())
  for (const key of defaultKeys) {
    assert.ok(isVolatileRef(validated[key]), 'field "' + key + '" is not a Volatile reference: the Plugins page form would not show it')
  }
})

test('config: an old Schemastery peer is replaced by the bundled copy, not accepted', async () => {
  const { selectSchema, VOLATILE_CONFIG_SUPPORTED } = await import('../lib/index.js')

  // The shape a pre-volatile copy has: object()/boolean() exist, volatile() does not.
  const oldPeer = {
    object: (dict) => ({ dict }),
    boolean: () => ({}),
    string: () => ({}),
  }
  const fallback = selectSchema(oldPeer)
  assert.equal(fallback.source, 'vendored', 'a copy without volatile() must never be used: the page would be read-only')
  assert.equal(typeof fallback.schema.boolean().volatile, 'function', 'the bundled copy supports volatile')
  assert.equal(VOLATILE_CONFIG_SUPPORTED, true)

  // A capable peer is preferred, so the schema stays in sync with the running host.
  const modern = await import('@deepseek-ai/schemastery')
  const chosen = selectSchema(modern.default)
  assert.equal(chosen.source, 'host')

  // Broken peers degrade to the bundled copy instead of throwing at load.
  assert.equal(selectSchema(undefined).source, 'vendored')
  assert.equal(selectSchema({ object() { throw new Error('boom') } }).source, 'vendored')
})

test('config: the bundled schema produces refs the host recognizes', async () => {
  const { selectSchema } = await import('../lib/index.js')
  const WRITE = Symbol.for('cosmokit.volatile.write')
  const schema = selectSchema(undefined).schema
  const value = schema.object({ n: schema.number().default(7).volatile() })({})
  assert.equal(typeof value.n, 'object')
  assert.ok(WRITE in value.n, 'the ref must expose the shared write symbol, or the host cannot update or detect it')
  assert.equal(value.n.get(), 7)
})

test('config: markVolatile degrades instead of throwing on an older Schemastery', () => {
  const supportsVolatile = { volatile() { return { marked: true } } }
  assert.deepEqual(markVolatile(supportsVolatile), { marked: true })
  const older = { default: 1 }
  assert.equal(markVolatile(older), older, 'an older Schemastery copy must be used unchanged, never crash the plugin')
  assert.equal(markVolatile(undefined), undefined)
})

test('config: normalizeConfig restores nullable defaults the schema omits', { skip }, () => {
  assert.equal(normalizeConfig(plain(Config({}))).pageBudget, null)
  assert.equal(normalizeConfig(plain(Config({ pageBudget: 9 }))).pageBudget, 9, 'pageBudget must survive validation')
  assert.equal(normalizeConfig(plain(Config({ pageBudget: null }))).pageBudget, null)
})

test('config: no hardcoded tunables — binary paths and timeouts are declared fields', { skip }, () => {
  const validated = plain(Config({
    popplerPath: 'C:/p/pdftoppm.exe',
    ghostscriptPath: 'C:/g/mgs.exe',
    chktexPath: 'C:/c/chktex.exe',
    renderTimeoutMs: 1234,
    compileTimeoutMs: 4321,
  }))
  assert.equal(validated.popplerPath, 'C:/p/pdftoppm.exe')
  assert.equal(validated.ghostscriptPath, 'C:/g/mgs.exe')
  assert.equal(validated.chktexPath, 'C:/c/chktex.exe')
  assert.equal(validated.renderTimeoutMs, 1234)
  assert.equal(validated.compileTimeoutMs, 4321)
})

test('config: switches and enum-ish fields survive an override', { skip }, () => {
  const validated = plain(Config({ enableDaily: false, enableVto: false, enableChktex: true, uploadScope: 'never', rendererOrder: ['miktex-ghostscript'] }))
  assert.equal(validated.enableDaily, false)
  assert.equal(validated.enableVto, false)
  assert.equal(validated.enableChktex, true)
  assert.equal(validated.uploadScope, 'never')
  assert.deepEqual(validated.rendererOrder, ['miktex-ghostscript'])
})

test('config: liveConfig re-reads the live source on every access', () => {
  const workDir = volatileRef('.latex-studio')
  const pageBudget = volatileRef(null)
  const ctx = { fiber: { config: { workDir, pageBudget, enableVto: volatileRef(true) } } }
  const config = liveConfig(ctx, {})

  assert.equal(config.workDir, '.latex-studio', 'live read must see the initial value')
  assert.equal(config.pageBudget, null)

  workDir[VOLATILE_WRITE]('.latex-studio-alt')
  pageBudget[VOLATILE_WRITE](9)

  assert.equal(config.workDir, '.latex-studio-alt', 'a saved edit must be visible without reloading the plugin')
  assert.equal(config.pageBudget, 9)
  assert.equal(config.enableVto, true)
})

test('config: liveConfig normalizes every field and falls back to DEFAULTS', () => {
  const ctx = { fiber: { config: { workDir: volatileRef('   '), uploadScope: volatileRef('bogus'), rendererOrder: volatileRef([]), compileTimeoutMs: volatileRef(0), attachImagesPerRound: volatileRef(-3) } } }
  const config = liveConfig(ctx, {})
  assert.equal(config.workDir, '   ', 'free-form strings are passed through untouched')
  assert.equal(config.uploadScope, DEFAULTS.uploadScope)
  assert.deepEqual(config.rendererOrder, [...DEFAULTS.rendererOrder])
  assert.equal(config.compileTimeoutMs, DEFAULTS.compileTimeoutMs)
  assert.equal(config.attachImagesPerRound, DEFAULTS.attachImagesPerRound)
  assert.equal(config.popplerPath, DEFAULTS.popplerPath, 'a field absent from the live source falls back to DEFAULTS')
})

test('config: liveConfig falls back to the entry config when no loader fiber is present', () => {
  const config = liveConfig({}, { pageBudget: 12, uploadScope: 'always' })
  assert.equal(config.pageBudget, 12)
  assert.equal(config.uploadScope, 'always')
  assert.equal(config.workDir, DEFAULTS.workDir)
})
