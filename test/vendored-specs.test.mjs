/**
 * Guard for the vendored PaperFit specification tree.
 *
 * The whole point of vendoring upstream specs is that the executing model reads
 * the same rules PaperFit used, instead of a paraphrase someone typed from
 * memory. That value evaporates if the tree drifts, loses its provenance, or
 * ships as files no skill provider can discover. This file locks all three.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { deriveDescription, withFrontmatter } from '../tools/vendor-paperfit-specs.mjs'
import { listPackageSkills } from '../tools/install-skills.mjs'
import { parseSkillDocument } from '../lib/core/skillpack.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(HERE, '..')
const UPSTREAM = path.join(PKG, 'docs', 'upstream', 'paperfit')
const MANIFEST = path.join(UPSTREAM, 'MANIFEST.json')
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

test('vendored specs: the manifest exists and records upstream provenance', () => {
  assert.ok(fs.existsSync(MANIFEST), 'docs/upstream/paperfit/MANIFEST.json is missing; run npm run vendor-specs')
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  assert.equal(manifest.upstream.license, 'MIT')
  assert.match(manifest.upstream.repository, /OpenRaiser\/PaperFit/)
  assert.match(manifest.upstream.paper, /2605\.10341/)
  assert.ok(manifest.upstream.version && manifest.upstream.version !== 'unknown', 'the upstream version must be recorded')
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0)
  for (const file of manifest.files) {
    assert.ok(file.dest && file.source && file.sourceSha, 'manifest entry incomplete: ' + JSON.stringify(file))
  }
})

test('vendored specs: every manifest entry exists on disk', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  for (const file of manifest.files) {
    assert.ok(fs.existsSync(path.join(PKG, file.dest)), 'missing vendored file: ' + file.dest)
  }
})

test('vendored specs: byte-identical files still match their recorded upstream hash', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  const verbatim = manifest.files.filter((f) => f.transform === 'none')
  assert.ok(verbatim.length >= 6, 'expected at least the 6 agent specs to be verbatim')
  for (const file of verbatim) {
    const actual = sha256(fs.readFileSync(path.join(PKG, file.dest)))
    assert.equal(actual, file.sourceSha, 'vendored file was edited; upstream text must stay byte-identical: ' + file.dest)
  }
})

test('vendored specs: frontmatter-transformed skills keep the upstream body intact', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  const transformed = manifest.files.filter((f) => f.transform === 'frontmatter')
  assert.ok(transformed.length >= 8, 'expected the 8 upstream skills to be vendored with frontmatter')
  for (const file of transformed) {
    const text = fs.readFileSync(path.join(PKG, file.dest), 'utf8')
    assert.ok(text.startsWith('---\n'), 'missing frontmatter: ' + file.dest)
    const end = text.indexOf('\n---', 3)
    assert.ok(end > 0, 'unterminated frontmatter: ' + file.dest)
    const body = text.slice(text.indexOf('\n', end + 1) + 1)
    // The body must be non-trivial and must still carry the upstream heading.
    assert.ok(body.length > 500, 'body looks truncated: ' + file.dest)
    assert.ok(/^#\s+/m.test(body), 'body lost its upstream heading: ' + file.dest)
    assert.ok(body.includes('概述') || body.includes('##'), 'body is not the upstream prose: ' + file.dest)
  }
})

test('vendored specs: the spec-drift check passes on the committed tree', () => {
  // Runs the real `--check` so this test exercises the same code path a
  // maintainer would, instead of reimplementing it.
  const out = execFileSync(process.execPath, [path.join(PKG, 'tools', 'vendor-paperfit-specs.mjs'), '--check'], {
    encoding: 'utf8',
    cwd: PKG,
  })
  assert.match(out, /paperfit specs OK/)
})

test('vendored specs: description derivation is mechanical and reproducible', () => {
  const body = ['# Some Skill', '', 'First paragraph of the upstream body.', 'Second line.'].join('\n')
  const description = deriveDescription(body)
  assert.match(description, /^Some Skill（vendored 自 PaperFit，MIT）/)
  assert.match(description, /First paragraph of the upstream body/)
  assert.equal(deriveDescription(body), description, 'derivation must be deterministic')
  // A body with no heading still yields a usable description rather than ''.
  assert.ok(deriveDescription('plain prose only').length > 0)
  assert.match(deriveDescription(''), /PaperFit upstream specification/)

  const composed = withFrontmatter('paperfit-x', 'desc', body)
  assert.ok(composed.startsWith('---\nname: paperfit-x\ndescription: desc\n---\n\n'))
  assert.ok(composed.endsWith(body), 'the upstream body must be appended untouched')
})

test('skill discovery: every packaged skill has valid, unique, kebab-case frontmatter', () => {
  const { skills, problems } = listPackageSkills()
  assert.deepEqual(problems, [], 'every packaged skill must parse: ' + JSON.stringify(problems))
  assert.equal(skills.length, 11, 'expected the 3 latex-* and 8 paperfit-* skills, got ' + skills.map((s) => s.dir).join(','))
  const names = new Set()
  for (const skill of skills) {
    // Official rule: ^[a-z0-9]+(?:-[a-z0-9]+)*$
    assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'bad skill name: ' + skill.name)
    assert.ok(skill.description.length > 10, 'description too short for routing: ' + skill.name)
    assert.ok(skill.content.length > 200, 'skill body looks empty: ' + skill.name)
    assert.equal(skill.dir, skill.name, 'directory name and frontmatter name must agree: ' + skill.dir)
    assert.ok(!names.has(skill.name), 'duplicate skill name: ' + skill.name)
    names.add(skill.name)
  }
  // The paperfit specs must be namespaced so they cannot shadow the local ones.
  for (const name of names) {
    if (name.startsWith('latex-')) continue
    assert.match(name, /^paperfit-/, 'vendored skills must be prefixed to avoid collisions: ' + name)
  }
})

test('skill discovery: a file without frontmatter is reported, not silently skipped', () => {
  // A silent skip is how three shipped skills went undiscovered for the life of
  // the repository, so the parser must name the reason.
  const parsed = parseSkillDocument(fs.readFileSync(path.join(UPSTREAM, 'CLAUDE.md'), 'utf8'))
  assert.equal(parsed.ok, false)
  assert.equal(parsed.reason, 'NO_FRONTMATTER')
})
