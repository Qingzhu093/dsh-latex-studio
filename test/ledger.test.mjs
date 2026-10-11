/**
 * Ledger, checklist enrichment and data-asset wiring (0.2.0).
 *
 * What this locks:
 *  - state.json v2 carries a cross-round defect ledger and reads v1 files safely;
 *  - the checklist exposes the taxonomy fields the model needs (visual
 *    indicators, log signals, semantic constraints, gate severity, manual);
 *  - the four previously-unread data files now have consumers
 *    (templates / writing_rules / content_boundaries / agent_roles);
 *  - the taxonomy's two routing copies and its inline thresholds are audited.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { STATE_VERSION, newState, withLedger, upsertLedger, saveState, loadState } from '../lib/core/state.js'
import {
  buildChecklist,
  auditTaxonomy,
  semanticLimits,
  semanticEditCheck,
  checkContentBoundaries,
  resolveTemplate,
  loadTemplates,
  loadWritingRules,
  loadContentBoundaries,
  loadAgentRoles,
} from '../lib/tools/vto.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'))

test('ledger: state v2 defaults to an empty ledger and reads v1 files safely', () => {
  assert.equal(STATE_VERSION, 2)
  const fresh = newState({ dir: process.cwd() })
  assert.deepEqual(fresh.ledger, { round: 0, entries: [] })

  // a v1 file on disk (no ledger key) must not break anything
  const work = tmp()
  const legacy = { version: 1, dir: work, round: 1, baseline: null, history: [] }
  saveState(work, legacy)
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
  assert.equal(first.regressions.length, 0)

  const second = upsertLedger(state, [{ id: 'A5', page: 3, severity: 'major', status: 'fixed' }], 2)
  assert.deepEqual(second.updated, ['A5#3'])
  const a5 = state.ledger.entries.find((e) => e.id === 'A5')
  assert.equal(a5.status, 'fixed')
  assert.equal(a5.firstSeenRound, 1, 'firstSeenRound must survive an update')
  assert.equal(a5.lastSeenRound, 2)
  assert.equal(a5.evidence, 'left column void 34%', 'evidence is preserved when not re-supplied')

  const third = upsertLedger(state, [{ id: 'A5', page: 3, severity: 'major', status: 'open' }], 3)
  assert.deepEqual(third.regressions, ['A5#3'], 'fixed -> open must be reported as a regression')
  assert.equal(state.ledger.round, 3)
  // same id on a different page is a different defect
  const other = upsertLedger(state, [{ id: 'A5', page: 7, severity: 'major', status: 'open' }], 3)
  assert.deepEqual(other.added, ['A5#7'])
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
  assert.ok(a5.visual_indicators.length > 0, 'A5 must say how to recognise it on the page')
  assert.ok(a5.log_signals.length > 0, 'A5 must map to log signals')
  assert.equal(a5.gate_blocking, true, 'major defects block the gate')
  assert.equal(double.find((d) => d.id === 'A4').gate_blocking, false, 'minor defects do not')
  // single-column documents drop the two-column-only defects
  assert.equal(buildChecklist({ columnType: 'single' }).length, 16)
})

test('taxonomy audit: routing copies and inline thresholds are cross-checked', () => {
  const warnings = auditTaxonomy()
  // A5 has fix_strategy.primary_skill = space-util-fixer but no skill_routing entry.
  assert.ok(warnings.some((w) => w.startsWith('A5 ') && w.includes('无归属')), 'expected the A5 routing gap, got: ' + warnings.join(' | '))
  // A2/A5 inline thresholds agree with layout_rules today: no drift warnings.
  assert.ok(!warnings.some((w) => w.includes('漂移')), 'unexpected threshold drift: ' + warnings.join(' | '))
})

test('writing_rules: semantic limits and the fix pre-check use the vendored caps', () => {
  const limits = semanticLimits()
  assert.deepEqual(limits.preferred, [3, 8])
  assert.equal(limits.hardMax, 15)
  assert.ok(limits.forbiddenSections.includes('abstract'))
  assert.ok(Object.keys(loadWritingRules()).length > 0, 'writing_rules.json must be read')

  const source = '\\begin{abstract}\nWe show that X works. It is fast.\n\\end{abstract}\n\\section{Method}\nWe train a model.\n'
  const inAbstract = semanticEditCheck(source, [{ find: 'We show that X works.', replace: 'We show that X works well.' }])
  assert.ok(inAbstract.blockers.some((b) => b.includes('abstract')), 'editing the abstract must be blocked: ' + JSON.stringify(inAbstract))
  const bigRewrite = semanticEditCheck(source, [{ find: 'We train a model.', replace: Array.from({ length: 40 }, (_, i) => 'w' + i).join(' ') }])
  assert.ok(bigRewrite.warnings.some((w) => w.includes('硬上限')), 'a 39-word change must warn: ' + JSON.stringify(bigRewrite))
  assert.equal(semanticEditCheck(source, [{ find: 'We train a model.', replace: 'We train a model.' }]).warnings.length, 0)
})

test('content_boundaries: critical sections are measured against their declared minima', () => {
  const boundaries = loadContentBoundaries()
  assert.ok((boundaries.critical_sections || []).length > 0, 'content_boundaries.json must be read')
  const short = checkContentBoundaries([{ path: 'main.tex', text: '\\begin{abstract}Too short.\\end{abstract}\n\\section{Introduction}\nA.\n' }])
  assert.equal(short.status, 'warn')
  assert.ok(short.short.includes('Abstract'))
  const longAbstract = Array.from({ length: 110 }, (_, i) => 'word' + i).join(' ') + '.'
  const ok = checkContentBoundaries([{ path: 'main.tex', text: '\\begin{abstract}Sentence one. Sentence two. Sentence three. ' + longAbstract + '\\end{abstract}\n\\section{Introduction}\n' + Array.from({ length: 5 }, (_, s) => Array.from({ length: 34 }, (_, i) => 'w' + s + '_' + i).join(' ') + '.').join(' ') }])
  assert.equal(ok.status, 'pass', 'expected pass, got ' + JSON.stringify(ok))
})

test('templates: resolveTemplate uses the vendored table and reports unknown ids', () => {
  const table = loadTemplates()
  const ids = Object.keys(table.templates || {})
  assert.ok(ids.length > 0, 'templates.json must be read')
  const known = resolveTemplate(ids[0])
  assert.equal(known.ok, true)
  assert.ok(known.template && known.template.column_type, 'a template must declare its column type')
  const missing = resolveTemplate('no-such-template-xyz')
  assert.equal(missing.ok, false)
  assert.deepEqual(missing.known, ids)
})

test('agent_roles: the role contract is read and cross-checked against the taxonomy', () => {
  const roles = loadAgentRoles()
  assert.ok(Object.keys(roles.agents || {}).length >= 5, 'agent_roles.json must be read')
  assert.ok(roles.routing && roles.routing.A, 'the category routing must be present')
})