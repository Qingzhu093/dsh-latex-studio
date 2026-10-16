#!/usr/bin/env node
/**
 * Build a static, self-contained preview of the plugin's configuration page.
 *
 * WHY THIS EXISTS
 * The page is a browser-half bundle: seeing it live needs the plugin redeployed
 * and DeepSeek Harness restarted. This generator renders the SAME field model
 * (\`preview-model\`), the SAME CSS (\`preview-css\`) and the SAME copy
 * (\`preview-dict\`) that lib/client.js ships, so a design review costs one
 * command instead of a restart — and the preview cannot drift into fiction,
 * because it is generated from the shipped source.
 *
 * The preview is read-only by construction: the generated markup carries no
 * event handlers, and the shell disables pointer events.
 *
 * Usage:
 *   node tools/build-preview.mjs                     # writes ./ui-preview.html
 *   node tools/build-preview.mjs --out <file.html>
 *
 * @module tools/build-preview
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULTS } from '../lib/config.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(HERE, '..')
const BUNDLE = path.join(PKG, 'lib', 'client.js')
const source = fs.readFileSync(BUNDLE, 'utf8')

/** Pull one marked region out of the client bundle. */
function region(name) {
  const pattern = new RegExp('// #region ' + name + '\\n([\\s\\S]*?)\\n\\s*// #endregion ' + name)
  const match = source.match(pattern)
  if (match === null) throw new Error('lib/client.js has no "' + name + '" region; the preview cannot be generated')
  return match[1]
}

/** Evaluate a region and return the value it declares. */
function evaluate(name, exported) {
  // eslint-disable-next-line no-new-func
  return new Function(region(name) + '\n;return ' + exported + ';')()
}

const T = evaluate('preview-dict', 'ZH')
const MODEL = evaluate('preview-model', 'MODEL')
const CSS = evaluate('preview-css', 'CSS')

const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const t = (key) => (typeof T[key] === 'string' ? T[key] : key)

/** A read-only control that looks exactly like the live one. */
function control(field, value) {
  if (field.kind === 'switch') {
    const on = value === true
    return '<div class="dshl-switchRow"><span class="dshl-switch" role="switch" aria-checked="' + on + '" data-on="' + on + '">'
      + '<span class="dshl-knob"></span></span><span class="dshl-hint">' + t(on ? 'badge.on' : 'badge.off') + '</span></div>'
  }
  if (field.kind === 'segmented') {
    return '<div class="dshl-seg" role="radiogroup">' + field.options.map((option) =>
      '<span class="dshl-segBtn" role="radio" data-active="' + (option.value === value) + '">' + t(option.labelKey) + '</span>').join('') + '</div>'
  }
  if (field.kind === 'checks') {
    const selected = Array.isArray(value) ? value : []
    let rank = 0
    return '<div class="dshl-checks">' + field.options.map((option) => {
      const checked = selected.indexOf(option.value) !== -1
      const order = checked ? '<span class="dshl-order">#' + String(++rank) + '</span>' : ''
      return '<label class="dshl-check"><input type="checkbox"' + (checked ? ' checked' : '') + '><span>' + t(option.labelKey) + '</span>' + order + '</label>'
    }).join('') + '</div>'
  }
  if (field.kind === 'select') {
    return '<select class="dshl-select">' + field.options.map((option) =>
      '<option' + (option.value === value ? ' selected' : '') + '>' + t(option.labelKey) + '</option>').join('') + '</select>'
  }
  const text = value === null || value === undefined ? '' : String(value)
  const placeholder = field.placeholderKey ? t(field.placeholderKey) : ''
  return '<div class="dshl-control"><input class="dshl-input" type="' + (field.kind === 'number' ? 'number' : 'text')
    + '" value="' + escape(text) + '" placeholder="' + escape(placeholder) + '">'
    + (field.unitKey ? '<span class="dshl-unit">' + unitLabel(field, value) + '</span>' : '') + '</div>'
}

/** One field row, mirroring the React renderer's structure. */
function fieldRow(field, value, modified, flags) {
  const labelRow = '<div class="dshl-labelRow"><span class="dshl-label">' + t(field.labelKey) + '</span>'
    + (field.restart ? '<span class="dshl-flag">' + t('badge.restart') + '</span>' : '')
    + (modified ? '<span class="dshl-flag">' + t('state.modified') + '</span>' : '')
    + (modified ? '<span class="dshl-reset">' + t('action.resetField') + '</span>' : '')
    + '</div>'
  const wide = field.wide === true || field.kind === 'number' || field.kind !== 'text'
  return '<div class="dshl-field' + (wide ? ' dshl-fieldWide' : '') + '">' + labelRow + control(field, value)
    + (field.hintKey ? '<span class="dshl-hint">' + t(field.hintKey) + '</span>' : '') + '</div>'
}

/** A duration a human can read at a glance, mirroring humanMs() in lib/client.js. */
function humanMs(value) {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return String(value)
  if (ms < 1000) return ms + ' ms'
  const seconds = ms / 1000
  if (seconds < 90) return seconds + ' s'
  return Math.round(seconds / 60) + ' min'
}

/** Short backend names, mirroring SHORT_BACKENDS in lib/client.js. */
const SHORT_BACKENDS = { poppler: 'poppler', 'miktex-ghostscript': 'Ghostscript', 'mineru-page': 'mineru' }

const unitLabel = (field, value) => {
  if (!field.unitKey) return ''
  if (field.unitKey !== 'unit.ms') return t(field.unitKey)
  const ms = Number(value)
  return Number.isFinite(ms) && ms >= 1000 ? t('unit.ms') + ' (≈ ' + humanMs(ms) + ')' : t(field.unitKey)
}

/** The card badge, mirroring cardSummary() in lib/client.js. */
function summary(section, values) {
  if (section.id === 'compile') {
    const driver = values.latexCommand
    return (driver === '' ? t('summary.compile.auto') : String(driver)) + ' · ' + humanMs(values.compileTimeoutMs)
  }
  if (section.id === 'render') return t('summary.render') + values.rendererOrder.map((id) => SHORT_BACKENDS[id] ?? id).join(' → ')
  if (section.id === 'read') return t('summary.read') + t('opt.uploadScope.' + values.uploadScope)
  if (section.id === 'vto') {
    const budget = values.pageBudget === null || values.pageBudget === undefined ? t('value.unset') : String(values.pageBudget) + ' 页'
    return t('summary.vto').replace('{workDir}', values.workDir) + ' · ' + budget + ' · ' + values.attachImagesPerRound + t('unit.images')
  }
  if (section.id === 'systems') return t('summary.systems').replace('{daily}', values.enableDaily ? t('badge.on') : t('badge.off')).replace('{vto}', values.enableVto ? t('badge.on') : t('badge.off'))
  if (section.id === 'checks') return values.enableChktex ? 'chktex ' + t('badge.on') : t('summary.checks.off')
  return ''
}

function card(section, values, user, open) {
  const values_ = {}
  for (const field of section.fields) values_[field.key] = values[field.key]
  const badges = '<span class="dshl-badges">'
    + (section.id === 'systems' ? '<span class="dshl-badge dshl-badgeWarn">' + t('badge.restart') + '</span>' : '')
    + '<span class="dshl-badge">' + summary(section, values_) + '</span></span>'
  const head = '<div class="dshl-cardHead"><span class="dshl-chev" data-open="' + open + '" aria-hidden="true">▶</span>'
    + '<span class="dshl-cardTitles"><span class="dshl-cardTitle">' + t(section.titleKey) + '</span>'
    + '<span class="dshl-cardDesc">' + t(section.descKey) + '</span></span>'
    + badges + '</div>'
  if (!open) return '<section class="dshl-card">' + head + '</section>'
  const body = '<div class="dshl-cardBody"><div class="dshl-grid">'
    + section.fields.map((field) => fieldRow(field, values[field.key], Object.prototype.hasOwnProperty.call(user, field.key), null)).join('')
    + '</div><div class="dshl-bar"><span class="dshl-btn">' + t('action.resetCard') + '</span></div></div>'
  return '<section class="dshl-card">' + head + body + '</section>'
}

const outFlag = process.argv.indexOf('--out')
const out = outFlag === -1 ? path.join(PKG, 'ui-preview.html') : path.resolve(process.argv[outFlag + 1])

const values = { ...DEFAULTS }
const user = { pageBudget: 9, uploadScope: 'always' }
Object.assign(values, user)
const openCards = { compile: true }

const shell = [
  '<!doctype html>',
  '<html lang="zh-CN">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>dsh-latex-studio 配置页预览</title>',
  '<style>',
  ':root{--dsw-alias-bg-layer-2:#f1f3f6;--dsw-alias-bg-layer-3:#fff;--dsw-alias-border-l2:#d7dbe0;--dsw-alias-label-primary:#111827;--dsw-alias-label-secondary:#374151;--dsw-alias-label-tertiary:#7b818b;--dsw-alias-label-dimmed:#9ca3af;--dsw-alias-brand-primary:#2563eb;--dsw-alias-button-primary-fill:#111827;--dsw-alias-state-success-primary:#15803d;--dsw-alias-state-success-tertiary:#f0fdf4;--dsw-alias-state-warn-primary:#b45309;--dsw-alias-state-warn-tertiary:#fffbeb}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:#eef1f4;font-family:"Segoe UI",system-ui,-apple-system,"Microsoft YaHei",sans-serif;color:#111827}',
  '.preview-banner{max-width:840px;margin:0 auto;padding:20px 16px 0;font-size:12px;line-height:18px;color:#6b7280}',
  '.preview-banner code{font-family:"Cascadia Code",Consolas,monospace;font-size:11px;background:#e2e6ea;border-radius:4px;padding:1px 4px}',
  '.preview-shell{max-width:840px;margin:0 auto;padding:12px 16px 48px}',
  '.preview-frame{background:#fff;border:1px solid #dfe3e8;border-radius:14px;padding:20px 20px 8px;box-shadow:0 1px 2px rgba(16,24,40,.05)}',
  CSS,
  '</style>',
  '</head>',
  '<body>',
  '<div class="preview-banner"><strong>静态预览</strong>：由 <code>dsh-latex-studio/lib/client.js</code> 的字段模型、CSS 与中文文案直接生成，'
    + '在插件面板中显示为「' + t('page.title') + '」。真实页面可交互：开关与下拉即时保存，文本框回车/失焦保存，每组与全局都能恢复默认。</div>',
  '<div class="preview-shell"><div class="preview-frame" style="pointer-events:none">',
  '<div class="dshl-root">',
  '<div class="dshl-head"><h3 class="dshl-title">' + t('page.title') + '</h3><p class="dshl-intro">' + t('page.intro') + '</p></div>',
  '<div class="dshl-bar"><span class="dshl-status" data-state="synced"><span class="dshl-dot"></span>' + t('state.synced') + '</span>',
  '<span class="dshl-spacer"></span><span class="dshl-btn">' + t('action.collapseAll') + '</span><span class="dshl-btn">' + t('action.resetAll') + '</span></div>',
  MODEL.map((section) => card(section, values, user, openCards[section.id] === true)).join(''),
  '</div>',
  '</div></div>',
  '</body>',
  '</html>',
].join('\n')

fs.writeFileSync(out, shell)
console.log('preview written: ' + out)
console.log('cards: ' + MODEL.length + ' · fields: ' + MODEL.reduce((total, section) => total + section.fields.length, 0) + ' · bytes: ' + shell.length)
