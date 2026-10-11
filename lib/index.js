/**
 * dsh-latex-studio host plugin entry.
 *
 * Registers two command systems, each behind a switch:
 *  - daily: latex_doctor / latex_build / latex_lint / bib_tool
 *  - vto:   vto_start / vto_inspect / vto_fix / vto_verify / vto_report
 *
 * It also delivers this package's skill pack through `ctx.skills.register()`.
 *
 * IMPORTANT — loading contract (why everything here is synchronous):
 * static imports plus a synchronous `apply()` keep registration ordering obvious
 * and free of top-level awaits. `registerDaily` / `registerVto` stay individually
 * guarded so one broken subsystem degrades to "not registered" instead of failing
 * the whole plugin.
 * @module dsh-latex-studio
 */
import Schema from '@deepseek-ai/schemastery'
import { normalizeConfig } from './config.js'
import { loadSkillPack, registerSkillPack } from './core/skillpack.js'
import { registerDaily } from './tools/daily.js'
import { registerVto } from './tools/vto.js'

export const name = 'dsh-latex-studio'
export const inject = ['tools']

/** Cordis config schema (mirrors lib/config.js DEFAULTS). */
export const Config = Schema.object({
  enableDaily: Schema.boolean().default(true),
  enableVto: Schema.boolean().default(true),
  uploadScope: Schema.string().default('external-only'),
  rendererOrder: Schema.array(Schema.string()).default(['poppler', 'miktex-ghostscript', 'mineru-page']),
  popplerPath: Schema.string().default(''),
  ghostscriptPath: Schema.string().default(''),
  readPdfToolName: Schema.string().default('read_pdf'),
  latexCommand: Schema.string().default(''),
  enableInstaller: Schema.boolean().default(true),
  engineArgs: Schema.string().default(''),
  compileTimeoutMs: Schema.number().default(300000),
  renderTimeoutMs: Schema.number().default(60000),
  workDir: Schema.string().default('.latex-studio'),
  pageBudget: Schema.union([Schema.number(), Schema.const(null)]).default(null),
  attachImagesPerRound: Schema.number().default(1),
  enableChktex: Schema.boolean().default(false),
  chktexPath: Schema.string().default(''),
})

/**
 * Register the enabled command systems and the skill pack.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - cordis context.
 * @param {Record<string, unknown>} [entryConfig] - patch config.
 * @returns {{registered: string[], failed: Array<{system: string, message: string}>, skills: {registered: string[], failed: Array<{name: string, message: string}>, problems: Array<{dir: string, reason: string}>, delivered: boolean}}}
 */
export function apply(ctx, entryConfig = {}) {
  const config = normalizeConfig(entryConfig)
  const logger = ctx?.logger ?? ctx?.console
  const registered = []
  const failed = []

  if (config.enableDaily) {
    try {
      registerDaily(ctx, config)
      registered.push('daily')
    } catch (error) {
      failed.push({ system: 'daily', message: String(error?.message ?? error) })
    }
  }

  if (config.enableVto) {
    try {
      registerVto(ctx, config)
      registered.push('vto')
    } catch (error) {
      failed.push({ system: 'vto', message: String(error?.message ?? error) })
    }
  }

  // ---------------------------------------------------------------------
  // Skills: delivered BY the plugin, not by filesystem discovery.
  //
  // A DSH skill provider only scans configured roots (`<project>/.dsh/skills`,
  // `<dshHome>/skills`, `Config.customSkillDirs`, `Config.bundledSkillDir`); an
  // npm package's own `skills/` directory is NOT one of them. Registering here is
  // the plugin-native delivery path: no installer, no filesystem link, no profile
  // configuration — and because registration is an effect it is undone on unload.
  //
  // `skills` is an OPTIONAL dependency, read through `ctx.get`, deliberately kept
  // out of `inject`: a host without a skills service must still get the 9 tools
  // instead of leaving this plugin PENDING forever.
  // ---------------------------------------------------------------------
  const skills = { registered: [], failed: [], problems: [], delivered: false }
  try {
    const service = typeof ctx?.get === 'function' ? ctx.get('skills') : undefined
    if (service && typeof service.register === 'function') {
      skills.delivered = true
      const pack = loadSkillPack()
      skills.problems = pack.problems
      const outcome = registerSkillPack(service, pack.skills)
      skills.registered = outcome.registered
      skills.failed = outcome.failed
    }
  } catch (error) {
    skills.failed.push({ name: '*', message: String((error && error.message) || error) })
  }

  if (failed.length > 0 && typeof logger?.warn === 'function') {
    logger.warn('[dsh-latex-studio] subsystems failed to load: ' + failed.map((f) => f.system + ': ' + f.message).join('; '))
  }
  if (skills.failed.length > 0 && typeof logger?.warn === 'function') {
    logger.warn('[dsh-latex-studio] skill registration failed: ' + skills.failed.map((f) => f.name + ': ' + f.message).join('; '))
  }
  if (skills.problems.length > 0 && typeof logger?.warn === 'function') {
    logger.warn('[dsh-latex-studio] skill pack problems: ' + skills.problems.map((p) => p.dir + ': ' + p.reason).join('; '))
  }
  if (typeof logger?.info === 'function') {
    logger.info('[dsh-latex-studio] registered: ' + (registered.join(', ') || 'none') + ' | skills: ' + (skills.registered.length || 'none'))
  }

  return { registered, failed, skills }
}
