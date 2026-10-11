#!/usr/bin/env node
/**
 * Vendor PaperFit's agent/skill specification text into this package.
 *
 * WHY A SCRIPT AND NOT A COPY-PASTE
 * ---------------------------------
 * The vendored text is ~100 KB of upstream specification. Hand-copying it once
 * guarantees the next reader cannot tell which upstream version it came from or
 * reproduce it. This script records source, version, source hash and destination
 * for every file, writes `docs/upstream/paperfit/MANIFEST.json`, and can re-run
 * idempotently (`--check` verifies that the tree still matches the manifest).
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It never rewrites upstream prose. The only edit is a YAML frontmatter block
 * required by the DSH skill provider (`name` + `description`); the original body
 * follows byte-for-byte. Upstream skills have no frontmatter of their own, so
 * nothing is being replaced.
 *
 * Usage:
 *   node tools/vendor-paperfit-specs.mjs --from <paperfit-cli-dir>
 *   node tools/vendor-paperfit-specs.mjs --check
 *
 * @module tools/vendor-paperfit-specs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(HERE, '..')
const MANIFEST = path.join(PKG, 'docs', 'upstream', 'paperfit', 'MANIFEST.json')

/** Upstream agents -> docs/upstream/paperfit/agents/ (human/agent reference). */
const AGENT_FILES = [
  'orchestrator-agent.md',
  'rule-engine-agent.md',
  'layout-detective-agent.md',
  'code-surgeon-agent.md',
  'semantic-polish-agent.md',
  'quality-gatekeeper-agent.md',
]

/**
 * Upstream skills -> skills/paperfit-<name>/SKILL.md.
 * Renamed with a `paperfit-` prefix so they can never collide with this
 * package's own `latex-*` skills in a shared discovery root.
 */
const SKILL_DIRS = [
  'taxonomy-vto',
  'space-util-fixer',
  'float-optimizer',
  'consistency-polisher',
  'overflow-repair',
  'template-migrator',
  'visual-inspector',
  'writing-polish',
]

/** Other reference text. */
const REFERENCE_FILES = [
  ['CLAUDE.md', 'CLAUDE.md'],
  ['.claude/commands/fix-layout.md', 'commands/fix-layout.md'],
  ['.claude/commands/check-visual.md', 'commands/check-visual.md'],
  ['.claude/commands/repair-table.md', 'commands/repair-table.md'],
  ['.claude/commands/adjust-length.md', 'commands/adjust-length.md'],
  ['.claude/commands/migrate-template.md', 'commands/migrate-template.md'],
  ['.claude/commands/show-status.md', 'commands/show-status.md'],
  ['LICENSE', 'LICENSE'],
]

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

/**
 * Derive a one-line description from an upstream body: the first heading as the
 * subject, then the first prose paragraph. Kept mechanical so it is reproducible
 * and never editorialises upstream claims.
 */
export function deriveDescription(body) {
  const lines = String(body).split(/\r?\n/)
  let heading = ''
  let paragraph = []
  let seenBody = false
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') {
      if (paragraph.length > 0) break
      continue
    }
    if (!seenBody && /^#{1,3}\s+/.test(line)) {
      heading = line.replace(/^#{1,3}\s+/, '').trim()
      seenBody = true
      continue
    }
    if (/^#{1,3}\s+/.test(line)) continue
    if (/^[-*|>]/.test(line)) continue
    seenBody = true
    paragraph.push(line)
    if (paragraph.join(' ').length > 160) break
  }
  const text = paragraph.join(' ').replace(/\s+/g, ' ').trim()
  const head = heading || 'PaperFit upstream specification'
  const summary = text.length > 0 ? text.slice(0, 220) : head
  return head + '（vendored 自 PaperFit，MIT）' + (summary === head ? '' : '：' + summary)
}

/** Prepend the DSH-required frontmatter without touching the body. */
export function withFrontmatter(name, description, body) {
  return ['---', 'name: ' + name, 'description: ' + description, '---', '', String(body)].join('\n')
}

function readUtf8(file) {
  return fs.readFileSync(file, 'utf8')
}

/** Build every planned write as `{dest, content, sourceRel, sourceSha}`. */
function plan(fromDir) {
  const entries = []
  for (const agent of AGENT_FILES) {
    const source = path.join(fromDir, 'agents', agent)
    const buffer = fs.readFileSync(source)
    entries.push({
      dest: path.join('docs', 'upstream', 'paperfit', 'agents', agent),
      content: buffer,
      sourceRel: 'agents/' + agent,
      sourceSha: sha256(buffer),
      transform: 'none',
    })
  }
  for (const dir of SKILL_DIRS) {
    const source = path.join(fromDir, 'skills', dir, 'SKILL.md')
    const buffer = fs.readFileSync(source)
    const text = buffer.toString('utf8')
    const name = 'paperfit-' + dir
    entries.push({
      dest: path.join('skills', name, 'SKILL.md'),
      content: Buffer.from(withFrontmatter(name, deriveDescription(text), text), 'utf8'),
      sourceRel: 'skills/' + dir + '/SKILL.md',
      sourceSha: sha256(buffer),
      transform: 'frontmatter',
    })
  }
  for (const [rel, dest] of REFERENCE_FILES) {
    const source = path.join(fromDir, rel)
    if (!fs.existsSync(source)) continue
    const buffer = fs.readFileSync(source)
    entries.push({
      dest: path.join('docs', 'upstream', 'paperfit', dest),
      content: buffer,
      sourceRel: rel,
      sourceSha: sha256(buffer),
      transform: 'none',
    })
  }
  return entries
}

/** Confirm the tree still matches the manifest (no drift, no edits). */
function check() {
  if (!fs.existsSync(MANIFEST)) {
    console.error('no manifest at ' + MANIFEST + '; run without --check first')
    return 1
  }
  const manifest = JSON.parse(readUtf8(MANIFEST))
  const problems = []
  for (const entry of manifest.files) {
    const full = path.join(PKG, entry.dest)
    if (!fs.existsSync(full)) {
      problems.push('MISSING  ' + entry.dest)
      continue
    }
    const actual = sha256(fs.readFileSync(full))
    if (entry.transform === 'none' && actual !== entry.sourceSha) {
      problems.push('MODIFIED ' + entry.dest + ' (content no longer matches upstream)')
    }
  }
  if (problems.length > 0) {
    console.error('vendored spec drift:\n  ' + problems.join('\n  '))
    return 1
  }
  console.log('paperfit specs OK: ' + manifest.files.length + ' file(s) match docs/upstream/paperfit/MANIFEST.json')
  return 0
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--check')) return check()
  const at = argv.indexOf('--from')
  const fromDir = at >= 0 ? argv[at + 1] : null
  if (!fromDir) {
    console.error('usage: node tools/vendor-paperfit-specs.mjs --from <paperfit-cli-dir> | --check')
    return 2
  }
  if (!fs.existsSync(path.join(fromDir, 'agents')) || !fs.existsSync(path.join(fromDir, 'skills'))) {
    console.error('not a paperfit-cli directory (no agents/ and skills/): ' + fromDir)
    return 2
  }

  let upstreamVersion = 'unknown'
  let upstreamName = 'paperfit-cli'
  try {
    const pkg = JSON.parse(readUtf8(path.join(fromDir, 'package.json')))
    upstreamVersion = String(pkg.version ?? 'unknown')
    upstreamName = String(pkg.name ?? upstreamName)
  } catch {
    /* version stays unknown; recorded as such */
  }

  const entries = plan(fromDir)
  const files = []
  for (const entry of entries) {
    const full = path.join(PKG, entry.dest)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, entry.content)
    files.push({
      dest: entry.dest.split(path.sep).join('/'),
      source: entry.sourceRel,
      sourceSha: entry.sourceSha,
      transform: entry.transform,
      bytes: entry.content.length,
    })
  }

  const manifest = {
    schemaVersion: 1,
    upstream: {
      name: upstreamName,
      version: upstreamVersion,
      license: 'MIT',
      repository: 'https://github.com/OpenRaiser/PaperFit',
      paper: 'arXiv:2605.10341',
      note: 'Vendored as specification text. Algorithm ports are noted separately in THIRD_PARTY_NOTICES.md.',
    },
    generatedBy: 'tools/vendor-paperfit-specs.mjs',
    generatedAt: new Date().toISOString(),
    files,
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  console.log('vendored ' + files.length + ' file(s) from ' + upstreamName + '@' + upstreamVersion)
  for (const file of files) console.log('  ' + file.dest + '  (' + file.bytes + ' B, ' + file.transform + ')')
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main())
}
