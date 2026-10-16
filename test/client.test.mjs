/**
 * Client-half contract guard.
 *
 * The browser half (lib/client.js) is hand-written in the client module system's
 * lazy-CJS factory format, so nothing in the toolchain would catch a broken
 * bundle: no build, no type check, no lint. This file therefore loads the real
 * bundle inside a minimal React/DOM shim and asserts the contract the product
 * depends on:
 *
 *   * the loader wrapper and the requires (`react` only),
 *   * the two slot registrations and their exact keys — the bundle page is keyed
 *     by package name, the component page by "<package>#<row id>", which is what
 *     the Plugins page computes with `rowConfigKey`,
 *   * the model covers exactly the schema's fields, so a new config field cannot
 *     be added without appearing in the page,
 *   * every dictionary key the page can render exists in zh AND en,
 *   * the page renders, degrades (unavailable/read-only) and writes through
 *     `form.set` / `form.unset` / `form.mutate` — with no keyboard-time writes.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULTS } from '../lib/config.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'lib/client.js'), 'utf8')
const PACKAGE_NAME = 'dsh-latex-studio'
const ROW_ID = 'latex-studio'

// ---------------------------------------------------------------- mini React

function createElement(type, props, ...children) {
  const merged = { ...(props ?? {}) }
  if (children.length === 1) merged.children = children[0]
  else if (children.length > 1) merged.children = children
  return { type, props: merged }
}

let hookIndex = 0
let hooks = []

function callComponent(type, props) {
  const savedIndex = hookIndex
  const savedHooks = hooks
  hookIndex = 0
  hooks = []
  const rendered = type(props)
  hookIndex = savedIndex
  hooks = savedHooks
  return rendered
}

let cssText = ''
const documentStub = {
  head: { appendChild() {} },
  querySelector: () => null,
  createElement: () => ({
    dataset: {},
    set textContent(value) {
      cssText = String(value)
    },
  }),
}

const React = {
  createElement,
  Fragment: 'Fragment',
  useState(initial) {
    const index = hookIndex++
    if (hooks[index] === undefined) hooks[index] = typeof initial === 'function' ? initial() : initial
    return [hooks[index], (next) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next }]
  },
  useCallback(fn) { return fn },
  useMemo(fn) { return fn() },
  useEffect(fn) { const cleanup = fn(); return cleanup },
  useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
}

/** Load the real bundle; `require` may only resolve React. */
function loadBundle() {
  const required = []
  let module = null
  const windowStub = {
    __ModuleLoader__: {
      load(definition) {
        module = definition.factory((id) => {
          required.push(id)
          if (id === 'react') return React
          throw new Error('the client bundle must not require ' + id)
        })
      },
    },
  }
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'React', source)(windowStub, documentStub, React)
  assert.ok(module, 'the bundle must call window.__ModuleLoader__.load')
  return { module, required }
}

/** Walk an element tree, collecting text and host elements. */
function render(node, out) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') { out.text += String(node) + '\u0001'; return out }
  if (Array.isArray(node)) { for (const child of node) render(child, out); return out }
  if (typeof node.type === 'function') return render(callComponent(node.type, node.props), out)
  out.tags.push({ type: node.type, props: node.props ?? {} })
  return render((node.props ?? {}).children, out)
}

function renderToString(element) {
  hookIndex = 0
  hooks = []
  return render(element, { text: '', tags: [] })
}

/** The settings-form stub the page binds through `ctx.get("configForms")`. */
function fakeConfigForms(options = {}) {
  const writes = []
  const snapshot = {
    status: options.status ?? 'ready',
    value: options.value ?? { ...DEFAULTS },
    user: options.user ?? {},
    revision: 3,
    writable: options.writable ?? true,
    mode: 'host',
  }
  const form = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: (key, value) => { writes.push({ op: 'set', key, value }); return Promise.resolve(true) },
    unset: (key) => { writes.push({ op: 'unset', key }); return Promise.resolve(true) },
    mutate: (ops) => { writes.push({ op: 'mutate', ops }); return Promise.resolve(true) },
  }
  return {
    writes,
    service: {
      describe: () => ({ getSnapshot: () => ({ view: { namespaces: [{ ns: ROW_ID }] } }) }),
      get: (namespace) => {
        assert.equal(namespace, ROW_ID, 'the page must bind the profile entry id')
        return form
      },
    },
  }
}

function mount(bundle, configForms) {
  const registrations = []
  const dictionaries = []
  const ctx = {
    fiber: { entry: { options: { id: ROW_ID } } },
    effect: (fn) => (typeof fn === 'function' ? fn() : undefined),
    locale: { register: (ns, dicts) => dictionaries.push({ ns, dicts }) },
    slots: {
      inject: (name, callback) => callback(),
      register: (opts, component) => {
        registrations.push({ opts, component })
        return () => {}
      },
    },
    get: (id) => (id === 'configForms' ? configForms?.service : undefined),
  }
  bundle.apply(ctx)
  return { registrations, dictionaries, ctx }
}

const { module: bundle, required } = loadBundle()
const ZH = bundle.DICTIONARIES.zh
const EN = bundle.DICTIONARIES.en

// --------------------------------------------------------------------- tests

test('client: the bundle uses the lazy-CJS factory format and requires only react', () => {
  assert.match(source, /^\/\*\*/, 'the bundle keeps its documentation header')
  assert.match(source, /window\.__ModuleLoader__\.load\(/)
  assert.match(source, /id: "dsh-latex-studio"/)
  assert.deepEqual(required, ['react'], 'the client bundle must stay dependency-free apart from React')
})

test('client: apply registers the bundle page and the component page under the keys the Plugins page computes', () => {
  const { registrations, dictionaries } = mount(bundle, fakeConfigForms())
  assert.deepEqual(bundle.inject, ['slots', 'locale'])
  assert.deepEqual(dictionaries.map((entry) => entry.ns), ['latex-studio'])
  const byName = Object.fromEntries(registrations.map((entry) => [entry.opts.name, entry.opts]))
  assert.deepEqual(Object.keys(byName).sort(), ['plugins.bundle.config', 'plugins.row.config'])
  assert.equal(byName['plugins.bundle.config'].key, PACKAGE_NAME, 'the bundle page is keyed by package name')
  assert.equal(byName['plugins.row.config'].key, PACKAGE_NAME + '#' + ROW_ID, 'rowConfigKey(bundle, rowId)')
  for (const registration of registrations) assert.equal(registration.opts.locale, 'latex-studio')
})

test('client: the row id matches the row cordis.patch.yml inserts', () => {
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, new RegExp('id:\\s*' + ROW_ID + '\\b'), 'ROW_ID must be the row id the bundle inserts')
})

test('client: the page model covers exactly the schema fields', () => {
  const modeled = bundle.MODEL.flatMap((section) => section.fields.map((field) => field.key)).sort()
  assert.deepEqual(modeled, Object.keys(DEFAULTS).sort(), 'a config field and the page model drifted apart')
  assert.equal(new Set(modeled).size, modeled.length, 'a field is listed twice')
})

test('client: every dictionary key the page can render exists in zh and en', () => {
  const used = new Set(['state.synced', 'state.saving', 'state.loading', 'state.readonly', 'state.unavailable', 'state.unavailable.hint'])
  for (const section of bundle.MODEL) {
    used.add(section.titleKey)
    used.add(section.descKey)
    for (const field of section.fields) {
      for (const key of ['labelKey', 'hintKey', 'placeholderKey', 'unitKey']) if (field[key]) used.add(field[key])
      for (const option of field.options ?? []) used.add(option.labelKey)
    }
  }
  for (const match of source.matchAll(/\bt\("([^"]+)"\)/g)) used.add(match[1])
  const missingZh = [...used].filter((key) => typeof ZH[key] !== 'string')
  const missingEn = [...used].filter((key) => typeof EN[key] !== 'string')
  assert.deepEqual(missingZh, [], 'missing Chinese copy')
  assert.deepEqual(missingEn, [], 'missing English copy')
})

test('client: a ready form renders the page, its sections and its switches', () => {
  const configForms = fakeConfigForms()
  const { registrations } = mount(bundle, configForms)
  const page = registrations.find((entry) => entry.opts.name === 'plugins.bundle.config')
  const injected = page.opts.inject()
  const out = renderToString(createElement(page.component, { ...injected, view: 'page', t: (key) => ZH[key] ?? key }))

  assert.match(out.text, /LaTeX Studio 配置/)
  for (const section of bundle.MODEL) assert.ok(out.text.includes(ZH[section.titleKey]), 'missing section ' + section.id)
  const booleanFields = bundle.MODEL.flatMap((section) => section.fields).filter((field) => field.kind === 'switch')
  assert.equal(booleanFields.length, 4, 'four boolean fields ship a switch')
  const switches = out.tags.filter((tag) => tag.props.role === 'switch')
  assert.equal(switches.length, 1, 'only the card that starts open renders its controls')
  assert.ok(out.text.includes(ZH['state.synced']), 'a ready, writable form reports 已同步')
  assert.ok(cssText.includes('.dshl-card'), 'the page installs its own stylesheet')
})

test('client: flipping a switch writes through form.set, never a keyboard-time write', () => {
  const configForms = fakeConfigForms()
  const { registrations } = mount(bundle, configForms)
  const page = registrations.find((entry) => entry.opts.name === 'plugins.row.config')
  const injected = page.opts.inject()
  const out = renderToString(createElement(page.component, { ...injected, view: 'page', t: (key) => ZH[key] ?? key }))

  const installerSwitch = out.tags.find((tag) => tag.props.role === 'switch' && tag.props['aria-label'] === ZH['field.enableInstaller'])
  assert.ok(installerSwitch, 'the compile card is open by default, so its switch is rendered')
  assert.equal(installerSwitch.props.disabled, false)
  installerSwitch.props.onClick()
  assert.deepEqual(configForms.writes, [{ op: 'set', key: 'enableInstaller', value: false }])

  const textInputs = out.tags.filter((tag) => tag.type === 'input' && tag.props.type === 'text')
  assert.ok(textInputs.length > 0, 'text fields render an input')
  for (const input of textInputs) assert.equal(input.props.onChange.length, 1, 'typing only updates the draft, it never writes')
  assert.equal(configForms.writes.length, 1, 'no write happened while reading the form')
})

test('client: 恢复全部默认 writes one atomic unset of every field', () => {
  const configForms = fakeConfigForms({ user: { pageBudget: 9 } })
  const { registrations } = mount(bundle, configForms)
  const page = registrations.find((entry) => entry.opts.name === 'plugins.bundle.config')
  const injected = page.opts.inject()
  const out = renderToString(createElement(page.component, { ...injected, view: 'page', t: (key) => ZH[key] ?? key }))

  const resetAll = out.tags.find((tag) => tag.type === 'button' && tag.props.children === ZH['action.resetAll'])
  assert.ok(resetAll, 'the reset-all control is rendered')
  resetAll.props.onClick()
  assert.equal(configForms.writes.length, 1)
  const [write] = configForms.writes
  assert.equal(write.op, 'mutate')
  assert.equal(write.ops.length, Object.keys(DEFAULTS).length)
  for (const op of write.ops) assert.deepEqual(op, { op: 'unset', path: [op.path[0]] })
  assert.deepEqual(write.ops.map((op) => op.path[0]).sort(), Object.keys(DEFAULTS).sort())
})

test('client: a read-only form disables every control and says so', () => {
  const configForms = fakeConfigForms({ writable: false })
  const { registrations } = mount(bundle, configForms)
  const page = registrations.find((entry) => entry.opts.name === 'plugins.bundle.config')
  const injected = page.opts.inject()
  const out = renderToString(createElement(page.component, { ...injected, view: 'page', t: (key) => ZH[key] ?? key }))

  assert.ok(out.text.includes(ZH['state.readonly']))
  for (const tag of out.tags.filter((candidate) => candidate.props.role === 'switch')) assert.equal(tag.props.disabled, true)
  const resetAll = out.tags.find((tag) => tag.type === 'button' && tag.props.children === ZH['action.resetAll'])
  assert.equal(resetAll.props.disabled, true)
})

test('client: a deployment without the settings service degrades to a read-only page with defaults', () => {
  const { registrations } = mount(bundle, null)
  const page = registrations.find((entry) => entry.opts.name === 'plugins.bundle.config')
  const injected = page.opts.inject()
  const out = renderToString(createElement(page.component, { ...injected, view: 'page', t: (key) => ZH[key] ?? key }))

  assert.ok(out.text.includes(ZH['state.unavailable']), 'the page reports the missing configuration form')
  assert.ok(out.text.includes(ZH['state.unavailable.hint']), 'the page explains how to get the form')
  assert.ok(out.text.includes(ZH['field.latexCommand']), 'the fields still render with defaults')
})

test('client: the row summary view renders one line instead of the whole page', () => {
  const { registrations } = mount(bundle, fakeConfigForms())
  const page = registrations.find((entry) => entry.opts.name === 'plugins.row.config')
  const injected = page.opts.inject()
  const out = renderToString(createElement(page.component, { ...injected, view: 'summary', t: (key) => ZH[key] ?? key }))
  assert.match(out.text, /MiKTeX 原生编译/)
  assert.ok(!out.text.includes(ZH['page.title']), 'the summary is not the full page')
})
