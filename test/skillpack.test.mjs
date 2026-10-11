/**
 * Skill-pack tests: the plugin must DELIVER its skills itself.
 *
 * A DSH skill provider only scans configured roots, so an npm package's `skills/`
 * directory is invisible unless the plugin registers it. The original four
 * `latex-*` skills shipped that way and were never discovered once. These tests
 * pin the plugin-native path so that cannot recur.
 *
 * Run: node test/skillpack.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SKILL_NAME_RE, loadSkillPack, parseSkillDocument, registerSkillPack } from '../lib/core/skillpack.js'
import { apply, Config } from '../lib/index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(HERE, '..')

/** A recording `skills` service faithful to the documented SkillRegistration shape. */
function makeSkillsService() {
  const registered = []
  return {
    registered,
    register(skill) {
      registered.push(skill)
      return () => {}
    },
  }
}

function makeCtx({ skills } = {}) {
  const tools = []
  return {
    tools,
    ctx: {
      tools: { register: (t) => { tools.push(t.name); return () => {} } },
      get: (name) => (name === 'skills' ? skills : undefined),
      logger: { info() {}, warn() {} },
    },
  }
}

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

test('skillpack: parses name/description/whenToUse and keeps the body verbatim', () => {
  const doc = ['---', 'name: my-skill', 'description: does a thing', 'whenToUse: when needed', '---', '', '# Body', '', 'text'].join('\n')
  const parsed = parseSkillDocument(doc)
  assert.equal(parsed.ok, true, parsed.reason)
  assert.equal(parsed.name, 'my-skill')
  assert.equal(parsed.description, 'does a thing')
  assert.equal(parsed.whenToUse, 'when needed')
  assert.equal(parsed.body, '# Body\n\ntext')
})

test('skillpack: malformed documents report a reason instead of vanishing', () => {
  assert.equal(parseSkillDocument('no frontmatter').reason, 'NO_FRONTMATTER')
  assert.equal(parseSkillDocument('---\nname: x\n').reason, 'UNTERMINATED_FRONTMATTER')
  assert.equal(parseSkillDocument('---\ndescription: d\n---\nbody').reason, 'MISSING_NAME')
  assert.equal(parseSkillDocument('---\nname: x\n---\nbody').reason, 'MISSING_DESCRIPTION')
})

test('skillpack: name must match its directory or the skill is unreachable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-skillpack-'))
  try {
    fs.mkdirSync(path.join(dir, 'dir-name'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'dir-name', 'SKILL.md'), '---\nname: other-name\ndescription: d\n---\n\nbody text long enough to pass\n')
    fs.mkdirSync(path.join(dir, 'Bad_Name'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'Bad_Name', 'SKILL.md'), '---\nname: Bad_Name\ndescription: d\n---\n\nbody\n')
    fs.mkdirSync(path.join(dir, 'no-skill-md'), { recursive: true })
    const { skills, problems } = loadSkillPack(dir)
    assert.deepEqual(skills, [])
    const reasons = problems.map((p) => p.reason).sort()
    assert.ok(reasons.some((r) => r.startsWith('NAME_DIRECTORY_MISMATCH')), JSON.stringify(problems))
    assert.ok(reasons.some((r) => r.startsWith('INVALID_NAME')), JSON.stringify(problems))
    assert.ok(reasons.includes('NO_SKILL_MD'), JSON.stringify(problems))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('skillpack: an unreadable skills directory degrades with a reason', () => {
  const { skills, problems } = loadSkillPack(path.join(os.tmpdir(), 'dsh-nope-' + Date.now()))
  assert.deepEqual(skills, [])
  assert.match(problems[0].reason, /SKILLS_DIR_UNREADABLE/)
})

// ---------------------------------------------------------------------------
// the shipped pack
// ---------------------------------------------------------------------------

test('skillpack: the shipped pack loads clean with all 11 skills', () => {
  const { skills, problems } = loadSkillPack()
  assert.deepEqual(problems, [], 'shipped skill pack has problems: ' + JSON.stringify(problems))
  assert.equal(skills.length, 11)
  for (const skill of skills) {
    assert.match(skill.name, SKILL_NAME_RE)
    assert.ok(skill.description.length > 10)
    assert.ok(skill.content.length > 200, skill.name + ' body too small')
    assert.ok(!skill.content.startsWith('---'), skill.name + ' body must not include its own frontmatter')
  }
})

test('skillpack: registerSkillPack forwards the documented registration shape', () => {
  const service = makeSkillsService()
  const { registered, failed } = registerSkillPack(service, [
    { name: 'a-skill', description: 'desc', whenToUse: 'when', content: 'body' },
    { name: 'b-skill', description: 'desc', whenToUse: null, content: 'body' },
  ])
  assert.deepEqual(registered, ['a-skill', 'b-skill'])
  assert.deepEqual(failed, [])
  assert.equal(service.registered.length, 2)
  assert.deepEqual(Object.keys(service.registered[0]).sort(), ['content', 'description', 'invocation', 'name', 'whenToUse'])
  assert.deepEqual(service.registered[0].invocation, { modelInvocable: true, userInvocable: true })
  assert.ok(!('whenToUse' in service.registered[1]), 'a missing whenToUse must be omitted, not null')
})

test('skillpack: one failing registration does not abort the rest', () => {
  const registered = []
  const service = {
    register(skill) {
      if (skill.name === 'bad-skill') throw new Error('reserved name')
      registered.push(skill.name)
      return () => {}
    },
  }
  const outcome = registerSkillPack(service, [
    { name: 'ok-skill', description: 'd', content: 'b' },
    { name: 'bad-skill', description: 'd', content: 'b' },
    { name: 'later-skill', description: 'd', content: 'b' },
  ])
  assert.deepEqual(registered, ['ok-skill', 'later-skill'])
  assert.equal(outcome.failed.length, 1)
  assert.equal(outcome.failed[0].name, 'bad-skill')
})

// ---------------------------------------------------------------------------
// plugin-native delivery via apply()
// ---------------------------------------------------------------------------

test('apply: registers the whole skill pack through ctx.skills (no installer)', () => {
  const service = makeSkillsService()
  const { ctx, tools } = makeCtx({ skills: service })
  const result = apply(ctx, Config({}))

  assert.equal(tools.length, 9, 'the 9 tools must still register')
  assert.equal(result.skills.delivered, true)
  assert.deepEqual(result.skills.problems, [])
  assert.equal(result.skills.registered.length, 11)
  assert.equal(service.registered.length, 11)
  // Every registered skill must be a complete definition, not a stub.
  for (const skill of service.registered) {
    assert.match(skill.name, SKILL_NAME_RE)
    assert.ok(skill.description.length > 10, skill.name + ' description too short')
    assert.ok(skill.content.length > 200, skill.name + ' body too small')
    assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: true })
  }
  const names = service.registered.map((s) => s.name).sort()
  assert.deepEqual(names, [
    'latex-daily',
    'latex-fix-catalog',
    'latex-vto-loop',
    'paperfit-consistency-polisher',
    'paperfit-float-optimizer',
    'paperfit-overflow-repair',
    'paperfit-space-util-fixer',
    'paperfit-taxonomy-vto',
    'paperfit-template-migrator',
    'paperfit-visual-inspector',
    'paperfit-writing-polish',
  ])
})

test('apply: a host with no skills service still gets all 9 tools', () => {
  // `skills` is an optional dependency on purpose: putting it in `inject` would
  // leave this plugin PENDING forever on a composition without a skills provider,
  // and a PENDING plugin registers nothing at all.
  const { ctx, tools } = makeCtx({ skills: undefined })
  const result = apply(ctx, Config({}))
  assert.equal(tools.length, 9)
  assert.equal(result.skills.delivered, false)
  assert.deepEqual(result.skills.registered, [])
  assert.deepEqual(result.failed, [])
})

test('apply: a throwing skills service is contained, not fatal', () => {
  const ctx = {
    tools: { register: () => () => {} },
    get: () => ({ register() { throw new Error('skills registry exploded') } }),
    logger: { info() {}, warn() {} },
  }
  const result = apply(ctx, Config({}))
  assert.equal(result.failed.length, 0, 'the tool systems must not be blamed')
  assert.equal(result.skills.delivered, true)
  assert.equal(result.skills.registered.length, 0)
  assert.ok(result.skills.failed.length >= 1, 'failures must be reported, not swallowed')
})
