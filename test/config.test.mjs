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
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULTS, normalizeConfig } from '../lib/config.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const defaultKeys = Object.keys(DEFAULTS).sort()

let Config = null
let schemaError = ''
try {
  Config = (await import('../lib/index.js')).Config
} catch (error) {
  schemaError = String(error?.message ?? error)
}
const skip = Config ? false : 'Config schema unavailable (' + schemaError.slice(0, 80) + ')'

/** Every DEFAULTS key with a representative non-null value (so nullable ones materialise). */
function fullSample() {
  const sample = {}
  for (const [key, value] of Object.entries(DEFAULTS)) sample[key] = value === null ? 9 : value
  sample.pageBudget = 9
  return sample
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
  const validated = Config(fullSample())
  assert.deepEqual(Object.keys(validated).sort(), defaultKeys, 'schema dropped or invented a field')
})

test('config: schema defaults match DEFAULTS for every non-null field', { skip }, () => {
  const validated = Config({})
  for (const key of defaultKeys) {
    if (DEFAULTS[key] === null) continue
    assert.deepEqual(validated[key], DEFAULTS[key], 'schema default for "' + key + '" differs from DEFAULTS')
  }
})

test('config: normalizeConfig restores nullable defaults the schema omits', { skip }, () => {
  assert.equal(normalizeConfig(Config({})).pageBudget, null)
  assert.equal(normalizeConfig(Config({ pageBudget: 9 })).pageBudget, 9, 'pageBudget must survive validation')
  assert.equal(normalizeConfig(Config({ pageBudget: null })).pageBudget, null)
})

test('config: no hardcoded tunables — binary paths and timeouts are declared fields', { skip }, () => {
  const validated = Config({
    popplerPath: 'C:/p/pdftoppm.exe',
    ghostscriptPath: 'C:/g/mgs.exe',
    chktexPath: 'C:/c/chktex.exe',
    renderTimeoutMs: 1234,
    compileTimeoutMs: 4321,
  })
  assert.equal(validated.popplerPath, 'C:/p/pdftoppm.exe')
  assert.equal(validated.ghostscriptPath, 'C:/g/mgs.exe')
  assert.equal(validated.chktexPath, 'C:/c/chktex.exe')
  assert.equal(validated.renderTimeoutMs, 1234)
  assert.equal(validated.compileTimeoutMs, 4321)
})

test('config: switches and enum-ish fields survive an override', { skip }, () => {
  const validated = Config({ enableDaily: false, enableVto: false, enableChktex: true, uploadScope: 'never', rendererOrder: ['miktex-ghostscript'] })
  assert.equal(validated.enableDaily, false)
  assert.equal(validated.enableVto, false)
  assert.equal(validated.enableChktex, true)
  assert.equal(validated.uploadScope, 'never')
  assert.deepEqual(validated.rendererOrder, ['miktex-ghostscript'])
})
