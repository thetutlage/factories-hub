// What the builder and the watcher share: the config and state of the machine, commands, the tasks of a
// hub, changes of status, Paseo sessions and the reports to the fleet repository. state-machine.md gives
// the rules that these scripts follow.
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { hostname, homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { env as githubEnv } from './github.mjs'

export const HOME = process.env.FACTORY_HOME ?? join(homedir(), '.factory')
export const DRY = process.argv.includes('--dry-run')
export const HOST = hostname().replace(/\.local$/, '')

export const config = JSON.parse(readFileSync(join(HOME, 'config.json'), 'utf8'))
// owner/name of the fleet repository on GitHub, or null for a fleet elsewhere
export const FLEET_REPO = config.fleet.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? null
// the login of the factory on GitHub, so the watcher can tell its own activity from the activity of people
export const FACTORY_LOGIN = config.github ? config.github.slug : null

// with a GitHub App in the config, every git and gh call of the worker and its sessions uses the App
const SESSION_ENV = config.github ? githubEnv() : {}
Object.assign(process.env, SESSION_ENV)

const statePath = join(HOME, 'state.json')
export const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { hubs: {} }
export function saveState() {
  if (!DRY) writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

export function log(message) {
  const line = `${new Date().toISOString()} ${message}`
  console.log(line)
  if (!DRY) appendFileSync(join(HOME, 'worker.log'), `${line}\n`)
}

export function sh(bin, args, cwd, { check = true } = {}) {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8' })
  if (check && result.status !== 0) {
    throw new Error(`${bin} ${args.join(' ')} failed in ${cwd}:\n${result.stderr || result.stdout}`)
  }
  return { ok: result.status === 0, out: (result.stdout ?? '').trim(), err: (result.stderr ?? '').trim() }
}

// a command that changes something; with --dry-run it is only logged
export function act(bin, args, cwd) {
  if (DRY) return log(`would run: ${bin} ${args.join(' ')}  (in ${cwd})`)
  return sh(bin, args, cwd)
}

export const git = (args, cwd, opts) => sh('git', args, cwd, opts)
export const paseo = (args) => sh(config.paseo, args, HOME)
export const factoryOf = (dir) => JSON.parse(readFileSync(join(dir, 'factory.json'), 'utf8'))

// ---- tasks ----------------------------------------------------------------------------------------------

export function readTasks(hub) {
  const dir = join(hub, 'tasks')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => /^T-\d+-.*\.md$/.test(file))
    .map((file) => {
      const src = readFileSync(join(dir, file), 'utf8')
      const fm = src.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
      const meta = Object.fromEntries(fm.split('\n').map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]))
      const list = (v) => (v || '').replace(/[[\]"]/g, '').split(',').map((x) => x.trim()).filter(Boolean)
      return {
        id: meta.id,
        file,
        status: meta.status,
        repos: list(meta.repos),
        deps: list(meta.depends_on),
        prs: list(meta.pull_requests),
        rework: /^## Rework$/m.test(src),
        number: Number(meta.id?.slice(2)),
      }
    })
    .filter((task) => task.id)
}

// owner/name of each repository of the hub, from mars.yaml
export function repoSlugs(hub) {
  const yaml = readFileSync(join(hub, 'mars.yaml'), 'utf8')
  return Object.fromEntries(
    [...yaml.matchAll(/url:\s*\S*github\.com[:/]([\w.-]+\/([\w.-]+?))(?:\.git)?\s*$/gm)].map((m) => [m[2], m[1]])
  )
}

// ---- worktrees and status -------------------------------------------------------------------------------

// a worktree of the hub on origin's main, detached: what runs in it pushes with HEAD:main
export function hubWorktree(hub, folder, branch) {
  git(['fetch', '--quiet', 'origin'], hub)
  if (!existsSync(folder)) git(['worktree', 'add', '--quiet', '--detach', folder, branch], hub)
  else git(['checkout', '--quiet', '--force', '--detach', branch], folder)
}

export function removeFolder(hub, folder, task) {
  for (const repo of task?.repos ?? []) {
    const tree = join(folder, 'repos', repo)
    if (existsSync(tree)) git(['worktree', 'remove', '--force', tree], join(hub, 'repos', repo), { check: false })
  }
  git(['worktree', 'remove', '--force', folder], hub, { check: false })
  rmSync(folder, { recursive: true, force: true })
}

// The side effects of a change of status, as state-machine.md gives them: commit, push with a rebase when
// the push is rejected, then sync the issue. A rebase that conflicts on the status line means someone else
// changed the status, and the change is dropped.
export function setStatus(folder, task, from, to, message, branch) {
  const path = join(folder, 'tasks', task.file)
  const src = readFileSync(path, 'utf8')
  if (!new RegExp(`^status: ${from}$`, 'm').test(src)) return false
  writeFileSync(path, src.replace(new RegExp(`^status: ${from}$`, 'm'), `status: ${to}`))
  git(['add', join('tasks', task.file)], folder)
  git(['commit', '--quiet', '-m', message], folder)
  for (let attempt = 0; attempt < 3; attempt++) {
    if (git(['push', '--quiet', 'origin', 'HEAD:main'], folder, { check: false }).ok) {
      if (existsSync(join(folder, 'scripts/sync-issues.mjs'))) sh('node', ['scripts/sync-issues.mjs', task.id], folder, { check: false })
      return true
    }
    git(['fetch', '--quiet', 'origin'], folder)
    if (!git(['rebase', '--quiet', branch], folder, { check: false }).ok) {
      git(['rebase', '--abort'], folder, { check: false })
      return false
    }
  }
  return false
}

// a change of status in a short-lived worktree of the hub
export function changeStatus(hub, task, branch, from, to, message) {
  if (DRY) return log(`would set ${task.id} from ${from} to ${to}`) ?? true
  const folder = join(hub, '.factory/status', task.id)
  if (existsSync(folder)) git(['worktree', 'remove', '--force', folder], hub, { check: false })
  hubWorktree(hub, folder, branch)
  try {
    return setStatus(folder, task, from, to, message, branch)
  } finally {
    git(['worktree', 'remove', '--force', folder], hub, { check: false })
  }
}

// ---- sessions -------------------------------------------------------------------------------------------

// the sessions of Paseo, and a test for a session that still runs
export function sessions() {
  const agents = JSON.parse(paseo(['ls', '-a', '--json']).out)
  // `paseo run --quiet` prints an id that a full id starts with
  return (id) => agents.some((agent) => id && agent.id.startsWith(id) && agent.status === 'running')
}

// a Paseo session in a folder of the hub, in the mode of factory.json: nobody answers its prompts.
// With no thinking option, Paseo passes none, and the effort comes from the settings of the person.
export function startSession(folder, title, prompt) {
  if (DRY) return log(`would start the session "${title}" in ${folder}`)
  const factory = factoryOf(folder)
  const thinking = factory.build?.thinking
  const provider = factory.build?.provider ?? 'claude'
  if (provider.split('/')[0] === 'codex') linkForCodex(folder)
  return paseo([
    'run', '--no-wait', '--quiet',
    ...Object.entries(SESSION_ENV).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
    '--cwd', folder,
    '--provider', provider,
    '--mode', factory.build?.mode ?? 'auto',
    ...(thinking ? ['--thinking', thinking] : []),
    '--title', title,
    prompt,
  ]).out
}

// Codex reads AGENTS.md, not CLAUDE.md, and loads skills from .agents/skills, not .claude/skills, so a
// Codex session gets links to both. The links of skills inside .claude/skills work through the link of
// the folder. Git ignores the links.
function linkForCodex(folder) {
  const exclude = resolve(folder, git(['rev-parse', '--git-path', 'info/exclude'], folder).out)
  const excluded = existsSync(exclude) ? readFileSync(exclude, 'utf8').split('\n') : []
  mkdirSync(dirname(exclude), { recursive: true })
  for (const [link, target] of [['AGENTS.md', 'CLAUDE.md'], ['.agents/skills', '.claude/skills']]) {
    if (!existsSync(join(folder, target)) || existsSync(join(folder, link))) continue
    mkdirSync(dirname(join(folder, link)), { recursive: true })
    symlinkSync(join(folder, target), join(folder, link))
    if (!excluded.includes(`/${link}`)) appendFileSync(exclude, `/${link}\n`)
  }
}

// ---- reports --------------------------------------------------------------------------------------------

// Each report opens its own issue in the fleet repository, titled with the hub, the machine and the first
// line of the report. A person closes a problem when it is handled; a report that is no problem is closed
// at once. A report that cannot reach GitHub stays in the log, returns false, and does not stop the poll.
export function report(name, message, { problem = true } = {}) {
  const firstLine = message.split('\n')[0]
  log(`${name}: ${firstLine}`)
  if (DRY) return false
  if (!FLEET_REPO) return true
  const gh = (args) => sh('gh', [...args, '--repo', FLEET_REPO], HOME, { check: false })
  const created = gh(['issue', 'create', '--title', reportTitle(name, firstLine), '--body', message])
  if (!created.ok) return log(`${name}: the report did not reach GitHub: ${created.err || created.out}`) ?? false
  if (!problem) gh(['issue', 'close', created.out.trim()])
  return true
}

export function reportOnce(hubState, key, name, message) {
  if (hubState.notified[key]) return
  hubState.notified[key] = new Date().toISOString()
  report(name, message)
}

// `<hub> on <machine>: <text>`, with the Markdown marks of the text removed, and at most 100 characters of it
export function reportTitle(name, text) {
  const plain = text.replace(/[*`]/g, '')
  return `${name} on ${HOST}: ${plain.length > 100 ? `${plain.slice(0, 99)}…` : plain}`
}

// where a session opens an issue for a fault outside its task, or null for a fleet that is not on GitHub
export function reportTarget(name) {
  return FLEET_REPO ? { repo: FLEET_REPO, titlePrefix: reportTitle(name, '') } : null
}
