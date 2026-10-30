// Copies the factory skills from factories-hub into .claude/skills/, and its state machine to
// .claude/state-machine.md, so the hub carries them in git.
// The commit they came from is written to `skills.commit` in factory.json. Review the diff, then commit it.
// Change a skill in factories-hub, not in the hub: this script overwrites the hub's copy.
//
//   node scripts/update-skills.mjs                the latest commit of skills.ref
//   node scripts/update-skills.mjs --from <path>  a local factories-hub clone, as it is on disk
//   node scripts/update-skills.mjs --force        overwrite uncommitted changes to the skills
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const HUB = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const SKILLS = ['intake', 'probe', 'build', 'accept', 'triage']
const STATE_MACHINE = '.claude/state-machine.md'
const FORCE = process.argv.includes('--force')
const fromIndex = process.argv.indexOf('--from')
const FROM = fromIndex === -1 ? null : resolve(process.argv[fromIndex + 1])

const configPath = join(HUB, 'factory.json')
const config = JSON.parse(readFileSync(configPath, 'utf8'))

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`)
  return result.stdout.trim()
}

// the hub's own changes to a skill would be lost, so they stop the update
const changed = [...SKILLS.map((skill) => `.claude/skills/${skill}`), STATE_MACHINE].filter((path) => git(['status', '--porcelain', '--', path], HUB) !== '')
if (changed.length && !FORCE) {
  console.error(`Uncommitted changes in ${changed.join(', ')}. Commit or discard them, or pass --force.`)
  process.exit(1)
}

// the source: a local clone as it is, or a fresh shallow clone of skills.ref
let source = FROM
let tmp = null
if (!source) {
  tmp = mkdtempSync(join(tmpdir(), 'factories-hub-'))
  git(['clone', '--quiet', '--depth', '1', '--branch', config.skills.ref ?? 'main', config.skills.repo, tmp])
  source = tmp
}
let commit = git(['rev-parse', 'HEAD'], source)
if (FROM && git(['status', '--porcelain', '--', 'skills', 'state-machine.md'], source) !== '') commit += '-dirty'

for (const skill of SKILLS) {
  const from = join(source, 'skills', skill)
  if (!existsSync(from)) throw new Error(`${from} does not exist`)
  const to = join(HUB, '.claude/skills', skill)
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true })
}
cpSync(join(source, 'state-machine.md'), join(HUB, STATE_MACHINE))
if (tmp) rmSync(tmp, { recursive: true, force: true })

// only the commit line changes, so the rest of factory.json keeps its layout
const text = readFileSync(configPath, 'utf8')
const updated = /"commit":\s*"[^"]*"/.test(text)
  ? text.replace(/"commit":\s*"[^"]*"/, `"commit": "${commit}"`)
  : text.replace(/("ref":\s*"[^"]*")/, `$1,\n    "commit": "${commit}"`)
writeFileSync(configPath, updated)

console.log(`Copied ${SKILLS.join(', ')} and the state machine from ${FROM ?? config.skills.repo} at ${commit}`)
console.log(git(['status', '--short', '--', '.claude/skills', STATE_MACHINE, 'factory.json'], HUB) || 'No changes')
