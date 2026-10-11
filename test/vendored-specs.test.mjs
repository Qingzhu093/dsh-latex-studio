/**
 * Guard for the vendored PaperFit reference tree (posture changed in 0.2.0).
 *
 * 0.2.0 does NOT register upstream prose as DSH skills. Registering it made the
 * model read a foreign contract (data/pages/, 220 DPI, /check-visual,
 * orchestrator/quality-gatekeeper) as the operating manual for this plugin, and
 * freezing it byte-identical meant this package could never adapt it. The
 * operational knowledge lives in this package's own skills/latex-*, which we own.
 *
 * What is left is provenance: docs/upstream/paperfit/** stays byte-identical to
 * upstream for humans, is listed in MANIFEST.json with per-file hashes, and does
 * NOT ship in the npm package. This file locks all three properties.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadSkillPack, parseSkillDocument } from '../lib/core/skillpack.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(HERE, '..')
const UPSTREAM = path.join(PKG, 'docs', 'upstream', 'paperfit')
const MANIFEST = path.join(UPSTREAM, 'MANIFEST.json')
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

test('vendored reference: the manifest exists and records upstream provenance', () => {
  assert.ok(fs.existsSync(MANIFEST), 'docs/upstream/paperfit/MANIFEST.json is missing; run npm run vendor-specs')
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  assert.equal(manifest.upstream.license, 'MIT')
  assert.match(manifest.upstream.repository, /OpenRaiser\/PaperFit/)
  assert.match(manifest.upstream.paper, /2605\.10341/)
  assert.ok(manifest.upstream.version && manifest.upstream.version !== 'unknown', 'the upstream version must be recorded')
  assert.match(String(manifest.posture ?? ''), /reference-only/, 'the manifest must record the reference-only posture')
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0)
  for (const file of manifest.files) {
    assert.ok(file.dest && file.source && file.sourceSha, 'manifest entry incomplete: ' + JSON.stringify(file))
  }
})

test('vendored reference: every manifest entry exists on disk and is byte-identical', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  for (const file of manifest.files) {
    const full = path.join(PKG, file.dest)
    assert.ok(fs.existsSync(full), 'missing vendored file: ' + file.dest)
    assert.equal(sha256(fs.readFileSync(full)), file.sourceSha, 'vendored file was edited; upstream text must stay byte-identical: ' + file.dest)
  }
})

test('vendored reference: no entry lives under skills/ (nothing upstream is registered)', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  const skillEntries = manifest.files.filter((f) => f.dest.startsWith('skills/'))
  assert.deepEqual(skillEntries, [], 'upstream prose must not be shipped as skills: ' + JSON.stringify(skillEntries.map((f) => f.dest)))
  const dirs = fs.readdirSync(path.join(PKG, 'skills')).sort()
  assert.deepEqual(dirs, ['latex-daily', 'latex-fix-catalog', 'latex-vto-loop'], 'skills/ must contain only this package\'s own skills')
})

test('vendored reference: the spec-drift check passes on the committed tree', () => {
  const out = execFileSync(process.execPath, [path.join(PKG, 'tools', 'vendor-paperfit-specs.mjs'), '--check'], {
    encoding: 'utf8',
    cwd: PKG,
  })
  assert.match(out, /paperfit reference OK/)
})

test('vendored reference: docs/ is not published', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'))
  assert.ok(!pkg.files.includes('docs'), 'docs/ must stay out of the published file set')
})

test('skill discovery: every packaged skill has valid, unique, kebab-case frontmatter', () => {
  const { skills, problems } = loadSkillPack()
  assert.deepEqual(problems, [], 'every packaged skill must parse: ' + JSON.stringify(problems))
  assert.deepEqual(skills.map((s) => s.name), ['latex-daily', 'latex-fix-catalog', 'latex-vto-loop'])
  const names = new Set()
  for (const skill of skills) {
    // Official rule: ^[a-z0-9]+(?:-[a-z0-9]+)*$
    assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'bad skill name: ' + skill.name)
    assert.ok(skill.description.length > 10, 'description too short for routing: ' + skill.name)
    assert.ok(skill.content.length > 200, 'skill body looks empty: ' + skill.name)
    assert.ok(!names.has(skill.name), 'duplicate skill name: ' + skill.name)
    names.add(skill.name)
  }
})

test('skill discovery: a file without frontmatter is reported, not silently skipped', () => {
  // A silent skip is how three shipped skills once went undiscovered.
  const parsed = parseSkillDocument(fs.readFileSync(path.join(UPSTREAM, 'CLAUDE.md'), 'utf8'))
  assert.equal(parsed.ok, false)
  assert.equal(parsed.reason, 'NO_FRONTMATTER')
})
