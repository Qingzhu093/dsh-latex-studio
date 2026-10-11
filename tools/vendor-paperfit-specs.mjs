#!/usr/bin/env node
/**
 * Vendor PaperFit's specification text into this package as READ-ONLY REFERENCE.
 *
 * POSTURE (changed in 0.2.0)
 * --------------------------
 * Upstream prose is **not** shipped as DSH skills any more. Registering it made
 * the model read a foreign contract (`data/pages/`, 220 DPI, `/check-visual`,
 * orchestrator/quality-gatekeeper roles) as the operating manual for THIS plugin,
 * and keeping it byte-identical meant the plugin could never adapt it. The
 * operating knowledge now lives in this package's own `skills/latex-*`, which we
 * own and may edit freely.
 *
 * What remains here is provenance: the upstream agent/command/reference text is
 * vendored under `docs/upstream/paperfit/` for humans and for anyone who wants to
 * read the original. `docs/` is deliberately NOT in the npm `files` whitelist, so
 * the reference does not ship to users.
 *
 * This script records source, version, per-file source hash and destination in
 * `docs/upstream/paperfit/MANIFEST.json`, and `--check` fails on any drift.
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

/** Upstream agent specifications -> docs/upstream/paperfit/agents/. */
const AGENT_FILES = [
  'orchestrator-agent.md',
  'rule-engine-agent.md',
  'layout-detective-agent.md',
  'code-surgeon-agent.md',
  'semantic-polish-agent.md',
  'quality-gatekeeper-agent.md',
]

/** Other upstream reference text -> docs/upstream/paperfit/. */
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

/** Confirm the reference tree still matches the manifest (no drift, no edits). */
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
  console.log('paperfit reference OK: ' + manifest.files.length + ' file(s) match docs/upstream/paperfit/MANIFEST.json')
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
  if (!fs.existsSync(path.join(fromDir, 'agents'))) {
    console.error('not a paperfit-cli directory (no agents/): ' + fromDir)
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
    posture: 'reference-only: upstream prose is NOT registered as DSH skills in 0.2.0+',
    upstream: {
      name: upstreamName,
      version: upstreamVersion,
      license: 'MIT',
      repository: 'https://github.com/OpenRaiser/PaperFit',
      paper: 'arXiv:2605.10341',
      note: 'Reference text for humans. Operational knowledge lives in this package own skills/latex-*; algorithm ports are noted in THIRD_PARTY_NOTICES.md.',
    },
    generatedBy: 'tools/vendor-paperfit-specs.mjs',
    generatedAt: new Date().toISOString(),
    files,
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  console.log('vendored ' + files.length + ' reference file(s) from ' + upstreamName + '@' + upstreamVersion)
  for (const file of files) console.log('  ' + file.dest + '  (' + file.bytes + ' B)')
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main())
}
