/**
 * Skill pack: turn this package's `skills/` directory into runtime skill
 * registrations.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * A DSH skill provider only discovers skills from *configured roots*
 * (`<project>/.dsh/skills`, `<dshHome>/skills`, `Config.customSkillDirs`,
 * `Config.bundledSkillDir`). An npm package's own `skills/` directory is **not**
 * one of them — so shipping `skills/` without registering it means the model
 * never sees any of it. That is exactly what happened here: the three `latex-*`
 * skills were published for the life of the repository and never once
 * discovered.
 *
 * DSH is plugin-centric, and a plugin already has a supported delivery path for
 * this: `ctx.skills.register(...)` during `apply()`. Registration is an effect,
 * so it is undone automatically on unload, needs no installer, no filesystem
 * link and no profile configuration.
 *
 * This module only *reads and parses*; the tool layer performs the registration
 * (core stays free of DSH imports).
 *
 * @module dsh-latex-studio/core/skillpack
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** This package's skill directory. */
const DEFAULT_SKILLS_DIR = fileURLToPath(new URL('../../skills/', import.meta.url))

/** Official rule from the Skills reference: kebab-case. */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Parse the minimal YAML frontmatter a skill needs.
 *
 * Deliberately not a YAML parser: the skill contract only requires `name`,
 * `description` and (optionally) `whenToUse`, all plain scalars. A full parser
 * would add a dependency for no benefit, and `dependencies: {}` is a hard
 * invariant of this package.
 *
 * @param {string} text - file content.
 * @returns {{ok: true, name: string, description: string, whenToUse: string|null, body: string} | {ok: false, reason: string}}
 */
export function parseSkillDocument(text) {
  const source = String(text ?? '')
  if (!source.startsWith('---')) return { ok: false, reason: 'NO_FRONTMATTER' }
  const end = source.indexOf('\n---', 3)
  if (end < 0) return { ok: false, reason: 'UNTERMINATED_FRONTMATTER' }
  const block = source.slice(3, end)
  const read = (key) => {
    const match = new RegExp('^' + key + ':\\s*(.*)$', 'm').exec(block)
    return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : null
  }
  const name = read('name')
  const description = read('description')
  if (!name) return { ok: false, reason: 'MISSING_NAME' }
  if (!description) return { ok: false, reason: 'MISSING_DESCRIPTION' }
  const body = source.slice(source.indexOf('\n', end + 1) + 1).replace(/^\s*\n/, '')
  return { ok: true, name, description, whenToUse: read('whenToUse') ?? read('when_to_use'), body }
}

/**
 * Load every skill in a directory tree (`<name>/SKILL.md`).
 *
 * Invalid entries are returned in `problems` rather than dropped: a silently
 * skipped skill is precisely the failure this module was written to end.
 *
 * @param {string} [skillsDir] - directory holding one subdirectory per skill.
 * @returns {{skills: Array<{name: string, description: string, whenToUse: string|null, content: string, dir: string}>, problems: Array<{dir: string, reason: string}>}}
 */
export function loadSkillPack(skillsDir = DEFAULT_SKILLS_DIR) {
  const skills = []
  const problems = []
  let entries
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true })
  } catch (error) {
    return { skills, problems: [{ dir: skillsDir, reason: 'SKILLS_DIR_UNREADABLE: ' + String((error && error.message) || error) }] }
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const dir = path.join(skillsDir, entry.name)
    const file = path.join(dir, 'SKILL.md')
    if (!fs.existsSync(file)) {
      problems.push({ dir: entry.name, reason: 'NO_SKILL_MD' })
      continue
    }
    let parsed
    try {
      parsed = parseSkillDocument(fs.readFileSync(file, 'utf8'))
    } catch (error) {
      problems.push({ dir: entry.name, reason: 'READ_FAILED: ' + String((error && error.message) || error) })
      continue
    }
    if (!parsed.ok) {
      problems.push({ dir: entry.name, reason: parsed.reason })
      continue
    }
    if (!SKILL_NAME_RE.test(parsed.name)) {
      problems.push({ dir: entry.name, reason: 'INVALID_NAME: ' + parsed.name })
      continue
    }
    if (parsed.name !== entry.name) {
      // The provider matches by the registered name; a mismatch makes the skill
      // unreachable under either spelling, so refuse it loudly.
      problems.push({ dir: entry.name, reason: 'NAME_DIRECTORY_MISMATCH: frontmatter="' + parsed.name + '" dir="' + entry.name + '"' })
      continue
    }
    if (parsed.body.trim().length === 0) {
      problems.push({ dir: entry.name, reason: 'EMPTY_BODY' })
      continue
    }
    skills.push({
      name: parsed.name,
      description: parsed.description,
      whenToUse: parsed.whenToUse,
      content: parsed.body,
      dir: entry.name,
    })
  }
  return { skills, problems }
}

/**
 * Register the whole pack on a `skills` service.
 *
 * Kept separate from {@link loadSkillPack} so the caller can decide policy
 * (which subset, what invocation flags) and so this stays testable with a stub.
 *
 * @param {{register: Function}} service - `ctx.skills`.
 * @param {Array<object>} skills - output of {@link loadSkillPack}.
 * @param {{modelInvocable?: boolean, userInvocable?: boolean, provider?: string}} [options] - invocation policy.
 * @returns {{registered: string[], failed: Array<{name: string, message: string}>}}
 */
export function registerSkillPack(service, skills, options = {}) {
  const registered = []
  const failed = []
  const invocation = {
    modelInvocable: options.modelInvocable !== false,
    userInvocable: options.userInvocable !== false,
  }
  for (const skill of skills) {
    try {
      service.register({
        name: skill.name,
        description: skill.description,
        ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
        content: skill.content,
        invocation,
        ...(options.provider ? { provider: options.provider } : {}),
      })
      registered.push(skill.name)
    } catch (error) {
      failed.push({ name: skill.name, message: String((error && error.message) || error) })
    }
  }
  return { registered, failed }
}
