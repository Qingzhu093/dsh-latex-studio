#!/usr/bin/env node
/**
 * FALLBACK ONLY — the supported delivery path is plugin-native registration.
 *
 * `lib/index.js` registers this package's whole skill pack through
 * `ctx.skills.register()` during `apply()`. That path needs no installer, no
 * filesystem link and no profile configuration, and it is undone automatically
 * when the plugin unloads. **Prefer it.**
 *
 * This script exists for the cases that path cannot cover: a deployment whose
 * plugin composition is not running (e.g. skills wanted in an editor or CI that
 * never boots DSH), or a host that exposes no `skills` service to plugins.
 *
 * WHY A ROOT IS NEEDED AT ALL
 * ---------------------------
 * A DSH skill provider only scans *configured roots* — see the official Skills
 * reference, "本地发现优先级":
 *
 *   rank 100  project-dsh     <projectRoot>/.dsh/skills
 *   rank 200  project-agents  <projectRoot>/.agents/skills
 *   rank 300  custom          Config.customSkillDirs
 *   rank 400  user-dsh        <dshHome>/skills
 *   rank 500  user-agents     <agentsHome>/skills
 *   rank 600  bundled         Config.bundledSkillDir
 *
 * An npm package's own `skills/` directory is NOT one of them.
 *
 * Usage:
 *   node tools/install-skills.mjs --check         # report only, change nothing
 *   node tools/install-skills.mjs                 # link into <dshHome>/skills (rank 400)
 *   node tools/install-skills.mjs --copy          # copy instead of link
 *   node tools/install-skills.mjs --root <dir>    # target another root
 *   node tools/install-skills.mjs --project <dir> # target <dir>/.dsh/skills (rank 100)
 *   node tools/install-skills.mjs --uninstall     # remove what this script installed
 *
 * @module tools/install-skills
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SKILL_NAME_RE, loadSkillPack } from '../lib/core/skillpack.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(HERE, '..')
const SKILLS_SRC = path.join(PKG, 'skills')

/** Every skill in this package, validated by the shared parser. */
export function listPackageSkills(skillsDir = SKILLS_SRC) {
  const { skills, problems } = loadSkillPack(skillsDir)
  return { skills, problems }
}

/** Default discovery root: `<dshHome>/skills` (rank 400), i.e. `~/.dsh/skills`. */
function defaultRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'skills')
}

function main() {
  const argv = process.argv.slice(2)
  const flagValue = (flag) => {
    const at = argv.indexOf(flag)
    return at >= 0 ? argv[at + 1] : null
  }
  const doCopy = argv.includes('--copy')
  const doCheck = argv.includes('--check')
  const doUninstall = argv.includes('--uninstall')
  const project = flagValue('--project')
  const root = flagValue('--root') || (project ? path.join(project, '.dsh', 'skills') : defaultRoot())

  const { skills, problems } = listPackageSkills()
  if (problems.length > 0) {
    console.error('refusing to install: invalid skill entries')
    for (const p of problems) console.error('  ' + p.dir + ': ' + p.reason)
    return 2
  }
  if (skills.length === 0) {
    console.error('refusing to install: no skills found in ' + SKILLS_SRC)
    return 2
  }

  console.log('root   : ' + root + (project ? '  (rank 100, project-dsh)' : '  (rank 400, user-dsh)'))
  console.log('skills : ' + skills.length + ' in ' + SKILLS_SRC)

  if (doUninstall) {
    let removed = 0
    for (const skill of skills) {
      const target = path.join(root, skill.name)
      if (!fs.existsSync(target)) continue
      fs.rmSync(target, { recursive: true, force: true })
      removed += 1
    }
    console.log('removed: ' + removed + ' (the plugin registers these itself when loaded)')
    return 0
  }

  if (doCheck) {
    let missing = 0
    for (const skill of skills) {
      const present = fs.existsSync(path.join(root, skill.name, 'SKILL.md'))
      if (!present) missing += 1
      console.log('  ' + (present ? 'OK      ' : 'MISSING ') + skill.name)
    }
    console.log(missing === 0 ? 'all skills present in this root' : missing + ' skill(s) not in this root')
    return missing === 0 ? 0 : 1
  }

  fs.mkdirSync(root, { recursive: true })
  let linked = 0
  let copied = 0
  let failed = 0
  for (const skill of skills) {
    const target = path.join(root, skill.name)
    try {
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
      if (doCopy) {
        fs.cpSync(path.join(SKILLS_SRC, skill.dir), target, { recursive: true })
        copied += 1
      } else {
        try {
          fs.symlinkSync(path.join(SKILLS_SRC, skill.dir), target, 'junction')
          linked += 1
        } catch {
          // A locked-down filesystem may refuse a link; copy instead of failing.
          fs.cpSync(path.join(SKILLS_SRC, skill.dir), target, { recursive: true })
          copied += 1
        }
      }
      if (!fs.existsSync(path.join(target, 'SKILL.md'))) {
        console.error('  FAILED  ' + skill.name + ' (SKILL.md not readable at the target)')
        failed += 1
      }
    } catch (error) {
      console.error('  FAILED  ' + skill.name + ': ' + String((error && error.message) || error))
      failed += 1
    }
  }
  console.log('linked : ' + linked + '   copied: ' + copied + '   failed: ' + failed)
  if (failed === 0) {
    console.log('note: this is the FALLBACK path. The plugin registers the same skills itself at load time;')
    console.log('      installing here as well can shadow or duplicate them in a root that also serves the loader.')
  }
  return failed === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exit(main())
}

void SKILL_NAME_RE

