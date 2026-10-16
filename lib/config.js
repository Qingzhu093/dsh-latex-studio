/**
 * Single source of truth for dsh-latex-studio configuration.
 * @module dsh-latex-studio/config
 */

/** Defaults mirror the Schemastery schema in lib/index.js. Every field is overridable. */
export const DEFAULTS = Object.freeze({
  // command systems
  enableDaily: true,
  enableVto: true,
  // privacy / PDF reading
  uploadScope: 'external-only', // external-only | always | never
  rendererOrder: ['poppler', 'miktex-ghostscript', 'mineru-page'],
  popplerPath: '',
  ghostscriptPath: '',
  readPdfToolName: 'read_pdf',
  // compile
  latexCommand: '', // '' = auto: prefer latexmk when it can run, else drive pdflatex/xelatex/lualatex directly
  enableInstaller: true,
  engineArgs: '',
  compileTimeoutMs: 300000,
  renderTimeoutMs: 60000,
  // orchestration
  workDir: '.latex-studio',
  pageBudget: null,
  attachImagesPerRound: 1,
  // optional extras
  enableChktex: false,
  chktexPath: '',
})

/**
 * The write symbol every cosmokit Volatile reference carries
 * (`Object.freeze({ get, [Symbol.for('cosmokit.volatile.write')] })`).
 * Checking the symbol directly keeps this module free of runtime dependencies
 * while staying immune to ESM/CJS copies of the shared library.
 * @type {symbol}
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * Is this a live config reference rather than a plain value?
 * @param {unknown} value - a validated config value.
 * @returns {boolean} whether the value implements the volatile reference protocol.
 */
export function isVolatileRef(value) {
  return typeof value === 'object' && value !== null && VOLATILE_WRITE in value
}

/**
 * Deep-copy a validated config tree, unwrapping every Volatile reference.
 * @param {unknown} value - validated config (may contain Volatile references).
 * @returns {unknown} the same tree built from plain values.
 */
export function configSnapshot(value) {
  if (isVolatileRef(value)) return configSnapshot(/** @type {{get:() => unknown}} */ (value).get())
  if (Array.isArray(value)) return value.map((item) => configSnapshot(item))
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const copy = {}
    for (const [key, child] of Object.entries(value)) copy[key] = configSnapshot(child)
    return copy
  }
  return value
}

/**
 * Mark a schema field volatile **when the resolved Schemastery supports it**.
 *
 * Why optional: the Gui form needs volatile fields (the settings service only
 * projects volatile fields into an editable form), but `Schema.prototype.volatile`
 * is not present in every Schemastery copy a host may resolve — measured on this
 * machine: the DSH app's copy has it, while a stale `@deepseek-ai/schemastery`
 * reached through `\$DSH_HOME/profiles/node_modules` does not. Calling
 * `.volatile()` unconditionally would make the WHOLE PLUGIN fail to load there,
 * which is a far worse outcome than a read-only configuration page.
 *
 * @param {any} schema - a Schemastery schema.
 * @returns {any} the volatile schema, or the schema unchanged on an older copy.
 */
export function markVolatile(schema) {
  return typeof schema?.volatile === 'function' ? schema.volatile() : schema
}

/**
 * Normalize ONE field, keeping array/scalar types sane.
 * Every field the plugin exposes goes through here, so `normalizeConfig` and
 * the live accessor cannot disagree about what a valid value is.
 * @param {string} key - one of DEFAULTS' keys.
 * @param {unknown} value - raw value.
 * @returns {unknown} the normalized value.
 */
export function normalizeField(key, value) {
  if (key === 'rendererOrder') {
    return Array.isArray(value) && value.length > 0 ? value.map((item) => String(item)) : [...DEFAULTS.rendererOrder]
  }
  if (key === 'uploadScope') {
    return value === 'always' || value === 'never' || value === 'external-only' ? value : DEFAULTS.uploadScope
  }
  if (key === 'pageBudget') {
    const budget = Number(value)
    return Number.isFinite(budget) && budget > 0 ? budget : null
  }
  if (key === 'compileTimeoutMs') {
    const timeout = Number(value)
    return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULTS.compileTimeoutMs
  }
  if (key === 'renderTimeoutMs') {
    const timeout = Number(value)
    return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULTS.renderTimeoutMs
  }
  if (key === 'attachImagesPerRound') {
    const count = Number(value)
    return Number.isFinite(count) && count >= 0 ? count : DEFAULTS.attachImagesPerRound
  }
  if (key in DEFAULTS) return value === undefined || value === null ? DEFAULTS[key] : value
  return value
}

/**
 * Merge user config over defaults, keeping array/scalar types sane.
 * @param {Record<string, unknown>|undefined} entryConfig - config from cordis.patch.yml.
 * @returns {typeof DEFAULTS & Record<string, unknown>} normalized config.
 */
export function normalizeConfig(entryConfig) {
  const merged = { ...DEFAULTS, ...(entryConfig ?? {}) }
  const normalized = {}
  for (const key of Object.keys(DEFAULTS)) normalized[key] = normalizeField(key, merged[key])
  return normalized
}

/**
 * Build a config accessor that re-reads the live plugin config on EVERY property
 * access. This is what makes the GUI form work: config fields are declared
 * `.volatile()`, the settings service swaps the Volatile references in place
 * when the user saves, and every tool reads `config.someField` at call time.
 * Reading a snapshot once (the pre-0.4.0 behaviour) would silently ignore saved
 * edits until a full plugin reload.
 *
 * `entryConfig` stays the fallback so tests and hosts without a loader fiber
 * keep working with a plain object.
 * @param {{fiber?: {config?: unknown}}} [ctx] - cordis context (may be undefined in tests).
 * @param {Record<string, unknown>} [entryConfig] - the config apply() received.
 * @returns {typeof DEFAULTS & Record<string, unknown>} live config accessor.
 */
export function liveConfig(ctx, entryConfig = {}) {
  const read = () => configSnapshot(ctx?.fiber?.config ?? entryConfig)
  const config = {}
  for (const key of Object.keys(DEFAULTS)) {
    Object.defineProperty(config, key, {
      enumerable: true,
      get: () => normalizeField(key, read()[key]),
    })
  }
  return /** @type {typeof DEFAULTS & Record<string, unknown>} */ (config)
}
