/**
 * Single source of truth for dsh-latex-studio configuration.
 * @module dsh-latex-studio/config
 */

/** Defaults mirror cordis.patch.yml. Every field is overridable by the profile patch. */
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
 * Merge user config over defaults, keeping array/scalar types sane.
 * @param {Record<string, unknown>|undefined} entryConfig - config from cordis.patch.yml.
 * @returns {typeof DEFAULTS & Record<string, unknown>} normalized config.
 */
export function normalizeConfig(entryConfig) {
  const merged = { ...DEFAULTS, ...(entryConfig ?? {}) }
  if (!Array.isArray(merged.rendererOrder) || merged.rendererOrder.length === 0) {
    merged.rendererOrder = [...DEFAULTS.rendererOrder]
  }
  if (merged.uploadScope !== 'always' && merged.uploadScope !== 'never') {
    merged.uploadScope = 'external-only'
  }
  const budget = Number(merged.pageBudget)
  merged.pageBudget = Number.isFinite(budget) && budget > 0 ? budget : null
  const timeout = Number(merged.compileTimeoutMs)
  merged.compileTimeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULTS.compileTimeoutMs
  return merged
}
