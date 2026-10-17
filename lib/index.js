/**
 * dsh-latex-studio host plugin entry.
 *
 * Registers two command systems, each behind a switch:
 *  - daily: latex_doctor / latex_build / latex_lint / bib_tool
 *  - vto:   vto_start / vto_inspect / vto_fix / vto_verify / vto_report
 *
 * It also delivers this package's skill pack through `ctx.skills.register()`,
 * opts out of the auto-generated settings page (the bundle ships its own, see
 * lib/client.js) and hands every kernel a LIVE config accessor.
 *
 * IMPORTANT — loading contract (why everything here is synchronous):
 * static imports plus a synchronous `apply()` keep registration ordering obvious
 * and free of top-level awaits. `registerDaily` / `registerVto` stay individually
 * guarded so one broken subsystem degrades to "not registered" instead of failing
 * the whole plugin.
 *
 * IMPORTANT — volatile config: every declared field is `.volatile()` so the
 * Plugins page form (lib/client.js) can edit it live. Cordis therefore hands
 * `apply` a config whose fields are Volatile references, NOT plain values; only
 * `liveConfig()` (lib/config.js) may be used to read them.
 *
 * IMPORTANT — the schema library is chosen at load time. The settings service
 * only projects Volatile fields, so a host that resolves an OLD
 * `@deepseek-ai/schemastery` (one without `Schema.prototype.volatile`) would
 * leave the configuration page permanently read-only — observed on a machine
 * whose profile-level peer tree still pointed at a pre-volatile global install.
 * `selectSchema()` therefore falls back to the copy bundled in
 * `lib/vendor/schemastery.mjs`; Volatile references are cross-copy compatible
 * because cosmokit identifies them with `Symbol.for("cosmokit.volatile.write")`.
 * @module dsh-latex-studio
 */
import SchemaPeer from '@deepseek-ai/schemastery'
import SchemaVendored from './vendor/schemastery.mjs'
import { liveConfig, markVolatile } from './config.js'
import { loadSkillPack, registerSkillPack } from './core/skillpack.js'
import { registerDaily } from './tools/daily.js'
import { registerVto } from './tools/vto.js'

export const name = 'dsh-latex-studio'
export const inject = ['tools']

/** The bundled Schemastery that always supports `.volatile()`. */
export const VENDORED_SCHEMA_SOURCE = 'vendored'

/**
 * Pick the schema implementation for this deployment.
 *
 * The host's copy is preferred: it is the one the running DSH ships, so schema
 * envelopes keep matching what the client and ConfigEditor expect. Only a copy
 * WITHOUT volatile support is rejected, because such a schema can never expose
 * fields to the settings service — and the page would silently be read-only.
 * @param {any} peer - `@deepseek-ai/schemastery` as resolved for this plugin.
 * @returns {{schema: any, source: 'host'|'vendored'}} the usable implementation and where it came from.
 */
export function selectSchema(peer) {
  try {
    if (peer && typeof peer.object === 'function' && typeof peer.boolean().volatile === 'function') {
      return { schema: peer, source: 'host' }
    }
  } catch {
    /* a broken/older copy is treated exactly like a missing one */
  }
  return { schema: SchemaVendored, source: VENDORED_SCHEMA_SOURCE }
}

const selection = selectSchema(SchemaPeer)

/** The Schemastery implementation `Config` is built with. */
export const Schema = selection.schema

/** Whether config is editable in the Plugins page (always true now: the bundled copy guarantees it). */
export const VOLATILE_CONFIG_SUPPORTED = typeof Schema.boolean().volatile === 'function'

/** `'host'` when the deployment's own Schemastery supports volatile, `'vendored'` when the bundle had to substitute. */
export const SCHEMA_SOURCE = selection.source

/**
 * Cordis config schema (mirrors lib/config.js DEFAULTS).
 *
 * Every field is marked volatile when the host's Schemastery supports it: that is
 * what makes it visible to the settings service and therefore editable from the
 * Plugins page (lib/client.js). `test/config.test.mjs` pins the schema/DEFAULTS
 * parity and the volatile marking.
 */
export const Config = Schema.object({
  enableDaily: markVolatile(Schema.boolean().default(true)),
  enableVto: markVolatile(Schema.boolean().default(true)),
  uploadScope: markVolatile(Schema.string().default('external-only')),
  rendererOrder: markVolatile(Schema.array(Schema.string()).default(['poppler', 'miktex-ghostscript', 'mineru-page'])),
  popplerPath: markVolatile(Schema.string().default('')),
  ghostscriptPath: markVolatile(Schema.string().default('')),
  readPdfToolName: markVolatile(Schema.string().default('read_pdf')),
  latexCommand: markVolatile(Schema.string().default('')),
  enableInstaller: markVolatile(Schema.boolean().default(true)),
  engineArgs: markVolatile(Schema.string().default('')),
  compileTimeoutMs: markVolatile(Schema.number().default(300000)),
  renderTimeoutMs: markVolatile(Schema.number().default(60000)),
  workDir: markVolatile(Schema.string().default('.latex-studio')),
  pageBudget: markVolatile(Schema.union([Schema.number(), Schema.const(null)]).default(null)),
  attachImagesPerRound: markVolatile(Schema.number().default(1)),
  enableChktex: markVolatile(Schema.boolean().default(false)),
  chktexPath: markVolatile(Schema.string().default('')),
})

/**
 * Tell the settings service this plugin renders its own configuration page.
 *
 * The settings package documents the contract: a plugin with a custom page
 * registers `configure({ auto: false }, ctx.fiber)` inside an optional
 * `ctx.inject(['settings'], ...)` child so a host without the service still
 * loads, and a late-loaded service still receives the policy. It only changes
 * page presentation — config reads and writes keep working either way.
 * @param {import('@deepseek-ai/cordis').Context} ctx - cordis context.
 * @returns {void}
 */
function declareSettingsPresentation(ctx) {
  if (typeof ctx?.inject !== 'function') return
  try {
    ctx.inject(['settings'], (scope) => {
      const settings = scope?.settings ?? scope?.get?.('settings')
      if (typeof settings?.configure !== 'function') return
      scope.effect(
        () => settings.configure({ auto: false }, scope.fiber ?? ctx.fiber),
        'dsh-latex-studio: settings presentation',
      )
    })
  } catch (error) {
    const logger = ctx?.logger ?? ctx?.console
    if (typeof logger?.warn === 'function') {
      logger.warn('[dsh-latex-studio] settings presentation not declared: ' + String(error?.message ?? error))
    }
  }
}

/**
 * Register the enabled command systems and the skill pack.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - cordis context.
 * @param {Record<string, unknown>} [entryConfig] - patch config (fields are Volatile references).
 * @returns {{registered: string[], failed: Array<{system: string, message: string}>, skills: {registered: string[], failed: Array<{name: string, message: string}>, problems: Array<{dir: string, reason: string}>, delivered: boolean}}}
 */
export function apply(ctx, entryConfig = {}) {
  const config = liveConfig(ctx, entryConfig)
  const logger = ctx?.logger ?? ctx?.console
  const registered = []
  const failed = []

  if (config.enableDaily) {
    try {
      registerDaily(ctx, entryConfig)
      registered.push('daily')
    } catch (error) {
      failed.push({ system: 'daily', message: String(error?.message ?? error) })
    }
  }

  if (config.enableVto) {
    try {
      registerVto(ctx, entryConfig)
      registered.push('vto')
    } catch (error) {
      failed.push({ system: 'vto', message: String(error?.message ?? error) })
    }
  }

  declareSettingsPresentation(ctx)

  // Advisory only: the bundled schema already prevents the read-only page, but a
  // stale peer tree is worth naming — it usually means the host's other packages
  // resolve to an old DSH install too.
  if (SCHEMA_SOURCE === VENDORED_SCHEMA_SOURCE && typeof logger?.warn === 'function') {
    logger.warn('[dsh-latex-studio] the host @deepseek-ai/schemastery has no .volatile() support (stale peer copy); using the bundled schemastery so the Plugins-page configuration form stays editable')
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
