// Gets this hub ready on this machine: checks the tools, checks the skills, clones the repositories,
// runs their setup, and adds the hub to Paseo. Run it in a fresh clone of the hub, and again at any time:
// it changes only what is missing. The hub's name and path come from the folder it runs in. The factory
// worker (worker/ in factories-hub) runs it for each hub of its fleet, and then starts the builds.
//
//   node scripts/setup.mjs                set up everything
//   node scripts/setup.mjs --dry-run      print what would change
//   node scripts/setup.mjs --no-paseo     skip Paseo
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

const HUB = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const NAME = basename(HUB)
const DRY = process.argv.includes('--dry-run')
const NO_PASEO = process.argv.includes('--no-paseo')
const SKILLS = ['intake', 'probe', 'build', 'accept', 'triage']

const config = JSON.parse(readFileSync(join(HUB, 'factory.json'), 'utf8'))

// the Paseo CLI is on the PATH after `npm i -g @getpaseo/cli`, and inside the desktop app otherwise
const PASEO = ['paseo', '/Applications/Paseo.app/Contents/Resources/bin/paseo'].find((bin) => ok(bin, ['--version']))

// how each tool proves that it is installed and signed in
const CHECKS = {
  // a call to the API, so that a login and the token of the factory's GitHub App both pass
  gh: ['api', 'rate_limit'],
  claude: ['auth', 'status'],
  docker: ['info'],
}

function ok(bin, args) {
  return spawnSync(bin, args, { stdio: 'ignore' }).status === 0
}

function read(bin, args, cwd = HUB) {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${bin} ${args.join(' ')} failed:\n${result.stderr}`)
  return result.stdout
}

// runs a command that changes something; with --dry-run it only prints it
function run(bin, args, cwd = HUB) {
  console.log(`  $ ${[bin, ...args].join(' ')}${cwd === HUB ? '' : `  (in ${relative(HUB, cwd)})`}`)
  if (DRY) return
  const result = spawnSync(bin, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${bin} ${args.join(' ')} failed`)
}

console.log(`Setting up ${NAME} in ${HUB}${DRY ? ' (dry run)' : ''}`)

// 1. the tools: stop with the list of what is missing, and install nothing
console.log('\nTools')
const missing = (config.tools ?? []).filter((tool) => {
  if (tool === 'paseo') return NO_PASEO ? false : !PASEO
  return !ok(tool, CHECKS[tool] ?? ['--version'])
})
if (missing.length) {
  console.error(`  Missing, or not signed in: ${missing.join(', ')}. Install them, sign in, and run the script again.`)
  process.exit(1)
}
console.log('  All present')

// 2. the skills are committed in the hub; a hub that has none yet copies them from factories-hub
console.log('\nSkills')
const absent = SKILLS.filter((skill) => !existsSync(join(HUB, '.claude/skills', skill, 'SKILL.md')))
if (!existsSync(join(HUB, '.claude/state-machine.md'))) absent.push('the state machine')
if (absent.length === 0) console.log(`  All present, from factories-hub at ${config.skills.commit ?? 'an unknown commit'}`)
else {
  run('node', [join(HUB, 'scripts/update-skills.mjs')])
  console.log('  Commit .claude/skills/ and factory.json, so every clone of the hub has them')
}

// 3. the repositories in mars.yaml, cloned into repos/
console.log('\nRepositories')
const names = [...readFileSync(join(HUB, 'mars.yaml'), 'utf8').matchAll(/url:\s*(\S+)/g)].map((m) =>
  basename(m[1]).replace(/\.git$/, '')
)
if (names.length === 0) console.log('  None in mars.yaml')
else run('npx', ['-y', '@dean0x/mars', 'clone'])

// 4. the setup of each repository, from factory.json
console.log('\nRepository setup')
for (const [name, repo] of Object.entries(config.repos ?? {})) {
  if (!repo.setup) continue
  const dir = join(HUB, 'repos', name)
  if (!names.includes(name)) console.log(`  ${name} is not in mars.yaml, skipped`)
  else if (!DRY && !existsSync(dir)) console.log(`  repos/${name} is missing, skipped`)
  else run('sh', ['-c', repo.setup], dir)
}

// 5. the Paseo project, so the sessions of the hub's builds show up together
console.log('\nPaseo')
if (NO_PASEO) console.log('  Skipped')
else {
  const projects = JSON.parse(read(PASEO, ['project', 'ls', '--json']))
  if (projects.some((project) => project.path === HUB)) console.log('  Project exists')
  else run(PASEO, ['project', 'create', HUB])
}

console.log(`\n${NAME} is ready${DRY ? ' (dry run: nothing changed)' : ''}`)
