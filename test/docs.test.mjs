/**
 * Documentation-traceability guard.
 *
 * This project's most expensive documented failure mode was not a crash: it was
 * docs and code drifting apart. Two concrete instances, both caught by hand:
 *
 *   1. `cordis.patch.yml` used to duplicate all 20 defaults, so overriding one
 *      field in a profile patch silently dropped the other 19 (a patch replaces
 *      the whole `config`, it does not merge). `test/config.test.mjs` now forbids
 *      a `config:` block there.
 *   2. `skills/latex-vto-loop/SKILL.md` told the MODEL that the work-dir layout
 *      contains `aux/` while the compiler writes `auxfiles/` — i.e. the plugin
 *      was instructing the model with a Windows-reserved name.
 *
 * Rather than fixing those numbers once and letting them rot again, this file
 * binds the volatile-but-checkable claims in the docs to the code. It is
 * deliberately narrow: it pins counts and identifiers, never prose, so editing
 * wording stays cheap.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULTS } from '../lib/config.js'
import { SUBDIRS } from '../lib/core/state.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const fieldCount = Object.keys(DEFAULTS).length

test('docs: the documented config-field count matches the code', () => {
  const handoff = read('docs/HANDOFF.md')
  const claimed = [...handoff.matchAll(/(\d+)\s*个配置字段/g)].map((m) => Number(m[1]))
  assert.ok(claimed.length > 0, 'HANDOFF.md no longer states a config field count; update this guard')
  for (const count of claimed) {
    assert.equal(count, fieldCount, 'HANDOFF.md claims ' + count + ' config fields but lib/config.js has ' + fieldCount)
  }
  // The README's config table must list exactly the declared fields.
  const readme = read('README.md')
  const table = /##+\s*3[^\n]*\n([\s\S]*?)(?=\n##+\s|\n*$)/.exec(readme)
  if (table) {
    const listed = [...table[1].matchAll(/^\|\s*`?([A-Za-z][A-Za-z0-9_]*)`?\s*\|/gm)].map((m) => m[1])
    const unknown = listed.filter((key) => !(key in DEFAULTS))
    assert.deepEqual(unknown, [], 'README.md config table lists fields that do not exist: ' + unknown.join(', '))
  }
})

test('docs: no shipped doc asks the model to use a reserved `aux/` work subdir', () => {
  // The compiler writes to `auxfiles`. `aux` is a reserved DOS device name.
  assert.ok(SUBDIRS.includes('auxfiles'), 'the compiler aux dir must be auxfiles')
  assert.ok(!SUBDIRS.includes('aux'), 'SUBDIRS must not create `aux`')
  const docs = ['README.md', 'docs/HANDOFF.md', 'docs/INTERFACES.md', 'skills/latex-daily/SKILL.md', 'skills/latex-vto-loop/SKILL.md', 'skills/latex-fix-catalog/SKILL.md']
  for (const rel of docs) {
    let text
    try {
      text = read(rel)
    } catch {
      continue // a doc may have been removed; absence is not drift
    }
    // A layout string is the harmful form: `{state.json,build/, ... ,pages/...}`.
    for (const line of text.split('\n')) {
      if (!/state\.json/.test(line)) continue
      assert.doesNotMatch(
        line,
        /(^|[,{(\s])aux\//,
        rel + ' documents a work-dir layout containing `aux/`; the compiler writes `auxfiles/`:\n  ' + line.trim(),
      )
    }
  }
})

test('docs: the handoff does not teach the removed 3-way config sync as current practice', () => {
  const handoff = read('docs/HANDOFF.md')
  // Describing the retired rule is fine (and useful history); INSTRUCTING the
  // reader to keep three copies in sync is what must never come back. Match per
  // line, skip lines that explicitly mark the rule as retired, and require an
  // imperative directly before 三处.
  const imperatives = ['必须', '务必', '需要', '应该', '应当', '记得', '仍要', '继续']
  const retired = /(已废除|旧规则|不再|已删除|曾经|历史)/
  const offenders = []
  for (const line of handoff.split('\n')) {
    if (retired.test(line)) continue
    for (const word of imperatives) {
      if (new RegExp(word + '[^。\\n]{0,6}三处').test(line)) {
        offenders.push(word + '...三处 :: ' + line.trim().slice(0, 120))
      }
    }
  }
  assert.deepEqual(offenders, [], 'HANDOFF.md still instructs keeping three copies in sync:\n' + offenders.join('\n'))
})

test('docs: every tool named in the README walkthrough actually exists', async () => {
  // The §3.1 walkthrough is the part a reader copies from. A stale tool or
  // parameter name there is worse than no walkthrough: it fails at the worst
  // moment, mid-task.
  //
  // NOTE ON SHAPE: a definition returned by the real registry is normalized —
  // `parameters` is a JSON Schema object with `properties`/`required`. The same
  // definitions reached through the daily-test stub keep the authoring shape
  // (a flat map with per-property `required: true`). Read both, so this guard
  // does not depend on which peer is installed.
  const parameterNames = (definition) => {
    const params = definition?.parameters
    if (!params || typeof params !== 'object') return []
    if (params.properties && typeof params.properties === 'object') return Object.keys(params.properties)
    return Object.keys(params)
  }
  const parameterEnum = (definition, name) => {
    const params = definition?.parameters
    if (!params || typeof params !== 'object') return undefined
    const node = params.properties ? params.properties[name] : params[name]
    return Array.isArray(node?.enum) ? node.enum : undefined
  }

  const { apply, Config } = await import('../lib/index.js')
  const registered = new Map()
  apply(
    {
      tools: { register: (t) => { registered.set(t.name, t); return () => {} } },
      get: () => undefined,
      logger: { info() {}, warn() {} },
    },
    Config({}),
  )
  const readme = read('README.md')
  const section = readme.slice(readme.indexOf('### 3.1 '), readme.indexOf('### 3.2 '))
  assert.ok(section.length > 500, 'the §3.1 walkthrough is missing or truncated')

  // Tool calls look like `name({...})` inside the code fences.
  const called = [...new Set([...section.matchAll(/^\s*(?:模型：)?\s*([a-z_]+)\(\{/gm)].map((m) => m[1]))]
  assert.ok(called.length >= 6, 'expected the walkthrough to name several tools, found: ' + called.join(', '))
  for (const name of called) {
    assert.ok(registered.has(name), 'README §3.1 calls a tool that does not exist: ' + name)
  }

  // Every `action: "x"` used for bib_tool must be a real enum member.
  const actions = [...section.matchAll(/action:\s*"([a-z]+)"/g)].map((m) => m[1])
  const bibEnum = parameterEnum(registered.get('bib_tool'), 'action')
  assert.ok(Array.isArray(bibEnum), 'bib_tool no longer declares an action enum; found: ' + JSON.stringify(bibEnum))
  for (const action of actions) {
    assert.ok(bibEnum.includes(action), 'README uses bib_tool action "' + action + '" which is not in ' + JSON.stringify(bibEnum))
  }

  // Parameter names used in the walkthrough must exist on the tool they are passed to.
  for (const line of section.split('\n')) {
    const match = /^\s*(?:模型：)?\s*([a-z_]+)\(\{([^}]*)\}\)/m.exec(line)
    if (!match) continue
    const definition = registered.get(match[1])
    if (!definition) continue
    const allowed = new Set(parameterNames(definition))
    for (const pair of match[2].split(',')) {
      const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(pair)
      if (!key) continue
      assert.ok(
        allowed.has(key[1]),
        'README §3.1 passes "' + key[1] + '" to ' + match[1] + ', which only accepts: ' + [...allowed].join(', '),
      )
    }
  }
})

test('docs: every shipped text file is valid UTF-8 with no replacement characters', () => {
  // Real incident: a PowerShell round-trip (`Get-Content -Raw` -> `Set-Content`)
  // rewrote README.md in the console's ANSI codepage and turned every Chinese
  // character into mojibake or U+FFFD. Node reported nothing; the file simply
  // became unreadable to humans. This test makes that class of damage loud.
  const roots = ['README.md', 'THIRD_PARTY_NOTICES.md', 'docs', 'skills', 'lib/data', 'tools']
  const problems = []
  const walk = (rel) => {
    const full = join(root, rel)
    let stat
    try {
      stat = statSync(full)
    } catch {
      return
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(full)) walk(join(rel, entry))
      return
    }
    if (!/\.(md|json|mjs|js|yml|yaml)$/i.test(rel)) return
    const bytes = readFileSync(full)
    const text = bytes.toString('utf8')
    if (text.includes('\uFFFD')) {
      problems.push(rel + ': contains U+FFFD (file was re-encoded by a non-UTF-8 writer)')
      return
    }
    if (bytes.length !== Buffer.byteLength(text, 'utf8')) {
      problems.push(rel + ': byte length disagrees with its UTF-8 decode (truncated or mis-encoded)')
      return
    }
    // A UTF-8 BOM is harmless but would break naive frontmatter parsers.
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      problems.push(rel + ': starts with a UTF-8 BOM')
    }
  }
  for (const rel of roots) walk(rel)
  assert.deepEqual(problems, [], 'text files must stay valid UTF-8:\n' + problems.join('\n'))
})

test('docs: the referenced core modules exist (no phantom module in the map)', () => {  const handoff = read('docs/HANDOFF.md')
  const listed = [...handoff.matchAll(/lib\/core\/([a-z]+)\.js/g)].map((m) => m[1])
  const unique = [...new Set(listed)]
  assert.ok(unique.length > 0, 'the module map disappeared from HANDOFF.md')
  for (const name of unique) {
    assert.doesNotThrow(() => read('lib/core/' + name + '.js'), 'HANDOFF.md references lib/core/' + name + '.js which does not exist')
  }
  // ...and the newest module must actually be documented, not silently omitted.
  assert.ok(unique.includes('paths'), 'HANDOFF.md omits lib/core/paths.js from its module map')
})
