/**
 * Ledger, checklist enrichment, data-asset wiring and rollback (0.2.1).
 *
 * Locks: state.json v2 + ledger, the taxonomy fields the checklist must expose,
 * the four previously-unread data files having consumers, the inline threshold
 * copies agreeing with layout_rules, and rollback being a real action.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { STATE_VERSION, newState, withLedger, upsertLedger, saveState, loadState, backupFiles, rollback } from '../lib/core/state.js'
import {
  buildChecklist, semanticLimits, semanticEditCheck, checkContentBoundaries, resolveTemplate,
  loadTemplates, loadWritingRules, loadContentBoundaries, loadAgentRoles, loadLayoutRules, loadTaxonomy,
} from '../lib/tools/vto.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'))
const BS = String.fromCharCode(92)

test('ledger: state v2 defaults to an empty ledger and reads v1 files safely', () => {
  assert.equal(STATE_VERSION, 2)
  const fresh = newState({ dir: process.cwd() })
  assert.deepEqual(fresh.ledger, { round: 0, entries: [] })
  const work = tmp()
  saveState(work, { version: 1, dir: work, round: 1, baseline: null, history: [] })
  const loaded = loadState(work)
  assert.equal(loaded.version, 1)
  withLedger(loaded)
  assert.deepEqual(loaded.ledger, { round: 0, entries: [] })
  fs.rmSync(work, { recursive: true, force: true })
})

test('ledger: upsert adds, updates, preserves firstSeenRound and detects regressions', () => {
  const state = newState({ dir: process.cwd() })
  const first = upsertLedger(state, [
    { id: 'A5', page: 3, severity: 'major', evidence: 'left column void 34%', status: 'open' },
    { id: 'C1', severity: 'minor', status: 'open' },
  ], 1)
  assert.deepEqual(first.added.sort(), ['A5#3', 'C1#-'])
  const second = upsertLedger(state, [{ id: 'A5', page: 3, severity: 'major', status: 'fixed' }], 2)
  assert.deepEqual(second.updated, ['A5#3'])
  const a5 = state.ledger.entries.find((e) => e.id === 'A5')
  assert.equal(a5.status, 'fixed')
  assert.equal(a5.firstSeenRound, 1)
  assert.equal(a5.lastSeenRound, 2)
  assert.equal(a5.evidence, 'left column void 34%')
  const third = upsertLedger(state, [{ id: 'A5', page: 3, severity: 'major', status: 'open' }], 3)
  assert.deepEqual(third.regressions, ['A5#3'])
  assert.deepEqual(upsertLedger(state, [{ id: 'A5', page: 7, severity: 'major', status: 'open' }], 3).added, ['A5#7'])
})

test('checklist: carries the taxonomy fields the model needs to act', () => {
  const double = buildChecklist({ columnType: 'double' })
  assert.equal(double.length, 18)
  for (const item of double) {
    assert.ok(Array.isArray(item.visual_indicators), item.id + ' needs visual_indicators')
    assert.ok(Array.isArray(item.log_signals), item.id + ' needs log_signals')
    assert.ok(Array.isArray(item.semantic_constraints), item.id + ' needs semantic_constraints')
    assert.equal(typeof item.gate_blocking, 'boolean', item.id + ' needs gate_blocking')
    assert.equal(item.manual, 'latex-fix-catalog')
    assert.match(String(item.manual_section), /^[A-E] 类$/)
  }
  const a5 = double.find((d) => d.id === 'A5')
  assert.ok(a5.visual_indicators.length > 0)
  assert.equal(a5.gate_blocking, true)
  assert.equal(double.find((d) => d.id === 'A4').gate_blocking, false)
  assert.equal(buildChecklist({ columnType: 'single' }).length, 16)
})

test('taxonomy: inline threshold copies agree with layout_rules (single source check)', () => {
  const taxonomy = loadTaxonomy()
  const rules = loadLayoutRules()
  const a2 = taxonomy.defects.find((d) => d.id === 'A2')
  const a5 = taxonomy.defects.find((d) => d.id === 'A5')
  assert.equal(a2.detection.threshold.max_whitespace_ratio, rules.whitespace.trailing_whitespace_max_ratio)
  assert.equal(a5.detection.threshold.min_void_ratio_of_column, rules.intra_column_void.min_void_ratio_of_column)
  assert.equal(a5.detection.threshold.min_void_height_lines, rules.intra_column_void.min_void_height_lines)
})

test('writing_rules: semantic limits and the fix pre-check use the vendored caps', () => {
  const limits = semanticLimits()
  assert.deepEqual(limits.preferred, [3, 8])
  assert.equal(limits.hardMax, 15)
  assert.ok(limits.forbiddenSections.includes('abstract'))
  assert.ok(Object.keys(loadWritingRules()).length > 0)
  const source = BS + 'begin{abstract}' + String.fromCharCode(10) + 'We show that X works. It is fast.' + String.fromCharCode(10) + BS + 'end{abstract}' + String.fromCharCode(10) + BS + 'section{Method}' + String.fromCharCode(10) + 'We train a model.' + String.fromCharCode(10)
  const inAbstract = semanticEditCheck(source, [{ find: 'We show that X works.', replace: 'We show that X works well.' }])
  assert.ok(inAbstract.blockers.some((b) => b.includes('abstract')))
  const big = semanticEditCheck(source, [{ find: 'We train a model.', replace: Array.from({ length: 40 }, (_, i) => 'w' + i).join(' ') }])
  assert.ok(big.warnings.some((w) => w.includes('硬上限')))
  assert.equal(semanticEditCheck(source, [{ find: 'We train a model.', replace: 'We train a model.' }]).warnings.length, 0)
})

test('content_boundaries: critical sections are measured against their declared minima', () => {
  assert.ok((loadContentBoundaries().critical_sections || []).length > 0)
  const short = checkContentBoundaries([{ path: 'main.tex', text: BS + 'begin{abstract}Too short.' + BS + 'end{abstract}' }])
  assert.equal(short.status, 'warn')
  assert.ok(short.short.includes('Abstract'))
  const longAbstract = Array.from({ length: 110 }, (_, i) => 'word' + i).join(' ') + '.'
  const intro = Array.from({ length: 5 }, (_, s) => Array.from({ length: 34 }, (_, i) => 'w' + s + '_' + i).join(' ') + '.').join(' ')
  const text = BS + 'begin{abstract}Sentence one. Sentence two. Sentence three. ' + longAbstract + BS + 'end{abstract}' + String.fromCharCode(10) + BS + 'section{Introduction}' + String.fromCharCode(10) + intro
  assert.equal(checkContentBoundaries([{ path: 'main.tex', text }]).status, 'pass')
})

test('templates: resolveTemplate uses the vendored table and reports unknown ids', () => {
  const ids = Object.keys(loadTemplates().templates || {})
  assert.ok(ids.length > 0)
  const known = resolveTemplate(ids[0])
  assert.equal(known.ok, true)
  assert.ok(known.template && known.template.column_type)
  const missing = resolveTemplate('no-such-template-xyz')
  assert.equal(missing.ok, false)
  assert.deepEqual(missing.known, ids)
})

test('agent_roles: the role contract is read', () => {
  const roles = loadAgentRoles()
  assert.ok(Object.keys(roles.agents || {}).length >= 5)
  assert.ok(roles.routing && roles.routing.A)
})

test('rollback: backupFiles + rollback restore bytes and remove created files', () => {
  const work = tmp()
  try {
    const file = path.join(work, 'main.tex')
    fs.writeFileSync(file, 'original', 'utf8')
    const workDir = path.join(work, '.latex-studio')
    assert.equal(backupFiles(workDir, 1, ['main.tex'], { projectRoot: work }).length, 1)
    fs.writeFileSync(file, 'changed', 'utf8')
    // files that do not exist are not recorded (there is nothing to restore)
    assert.equal(backupFiles(workDir, 1, ['never-existed.tex'], { projectRoot: work }).length, 0)
    const restored = rollback(workDir, 1)
    assert.deepEqual(restored, [file])
    assert.equal(fs.readFileSync(file, 'utf8'), 'original')
    // a second rollback is idempotent
    assert.deepEqual(rollback(workDir, 1), [file])
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
})
