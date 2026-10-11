#!/usr/bin/env node
/**
 * Development-time converter: PaperFit YAML config -> plain JSON data files.
 * The plugin never parses YAML at runtime (zero runtime dependencies).
 *
 * PaperFit's YAML contains raw LaTeX inside double-quoted scalars
 * (e.g. "0.98`linewidth"), which is invalid YAML escaping. We pre-double every
 * backslash on lines that carry a double-quoted scalar so the value survives
 * parsing as literal text, and report how many lines were rewritten.
 *
 * Usage:
 *   NODE_PATH=<dir with js-yaml> node tools/convert-yaml.mjs <paperfit-config-dir> [out-dir]
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = process.argv[2]
const outDir = process.argv[3] ?? join(here, '..', 'lib', 'data')
if (!srcDir) {
  console.error('usage: node tools/convert-yaml.mjs <paperfit-config-dir> [out-dir]')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })

const BS = String.fromCharCode(92)
const DBS = BS + BS
const LF = String.fromCharCode(10)

function repairQuotedBackslashes(text) {
  const lines = text.split(LF)
  let repaired = 0
  const out = lines.map((line) => {
    const t = line.trim()
    const carriesQuotedScalar = t.includes(': "') || t.startsWith('- "')
    if (!carriesQuotedScalar) return line
    repaired += 1
    return line.split(BS).join(DBS)
  })
  return { text: out.join(LF), repaired }
}

const files = readdirSync(srcDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
const meta = { source: 'PaperFit (MIT) config/', generatedAt: new Date().toISOString(), files: {} }
for (const f of files) {
  const raw = readFileSync(join(srcDir, f), 'utf8')
  const { text, repaired } = repairQuotedBackslashes(raw)
  const parsed = yaml.load(text)
  const out = join(outDir, basename(f).replace(/\.ya?ml$/, '.json'))
  writeFileSync(out, JSON.stringify(parsed, null, 2) + LF, 'utf8')
  meta.files[basename(f)] = { out, repairedLines: repaired }
  console.log('wrote', basename(out), '(repaired ' + repaired + ' lines)')
}
writeFileSync(join(outDir, '_meta.json'), JSON.stringify(meta, null, 2) + LF, 'utf8')
console.log('done')
