// The factory worker: one poll of the fleet. launchd runs it every few minutes (see install.mjs).
// For each hub in the fleet's hubs.json, it clones and sets up the hub once, then builds the next ready
// change task: it claims the task on GitHub, prepares a build folder of worktrees, and starts one Paseo
// session in it. A hub with nothing to build costs a `git fetch` and no session.
//
//   node worker/worker.mjs            one poll
//   node worker/worker.mjs --dry-run  print what the poll would do
//
// FACTORY_HOME (default ~/.factory) holds config.json, state.json, the fleet clone and worker.log.
import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, homedir } from 'node:os'
import { basename, join } from 'node:path'

const HOME = process.env.FACTORY_HOME ?? join(homedir(), '.factory')
const DRY = process.argv.includes('--dry-run')
const HOST = hostname().replace(/\.local$/, '')

const config = JSON.parse(readFileSync(join(HOME, 'config.json'), 'utf8'))
const statePath = join(HOME, 'state.json')
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { hubs: {} }

function log(message) {
  const line = `${new Date().toISOString()} ${message}`
  console.log(line)
  if (!DRY) appendFileSync(join(HOME, 'worker.log'), `${line}\n`)
}

function sh(bin, args, cwd, { check = true } = {}) {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8' })
  if (check && result.status !== 0) {
    throw new Error(`${bin} ${args.join(' ')} failed in ${cwd}:\n${result.stderr || result.stdout}`)
  }
  return { ok: result.status === 0, out: (result.stdout ?? '').trim(), err: (result.stderr ?? '').trim() }
}

// a command that changes something; with --dry-run it is only logged
function act(bin, args, cwd) {
  if (DRY) return log(`would run: ${bin} ${args.join(' ')}  (in ${cwd})`)
  return sh(bin, args, cwd)
}

const git = (args, cwd, opts) => sh('git', args, cwd, opts)
const paseo = (args) => sh(config.paseo, args, HOME)

// ---- one poll at a time ---------------------------------------------------------------------------------

const lockPath = join(HOME, 'worker.lock')
if (existsSync(lockPath)) {
  const pid = Number(readFileSync(lockPath, 'utf8'))
  if (spawnSync('kill', ['-0', String(pid)]).status === 0) process.exit(0)
}
if (!DRY) writeFileSync(lockPath, String(process.pid))

try {
  poll()
} catch (error) {
  log(`poll failed: ${error.message}`)
  process.exitCode = 1
} finally {
  if (!DRY) {
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
    rmSync(lockPath, { force: true })
  }
}

function poll() {
  // the fleet: a clone that only the worker reads
  const fleetDir = join(HOME, 'fleet')
  if (!existsSync(fleetDir)) git(['clone', '--quiet', config.fleet, fleetDir], HOME)
  else git(['pull', '--quiet', '--ff-only'], fleetDir)
  const urls = JSON.parse(readFileSync(join(fleetDir, 'hubs.json'), 'utf8'))

  for (const url of urls) {
    try {
      pollHub(url)
    } catch (error) {
      log(`${url}: ${error.message}`)
    }
  }
}

// ---- a hub ----------------------------------------------------------------------------------------------

function pollHub(url) {
  const name = basename(url).replace(/\.git$/, '')
  const hub = join(config.hubsDir, name)
  const hubState = (state.hubs[name] ??= { builds: {}, notified: {} })

  if (!existsSync(hub)) {
    log(`${name}: new hub, cloning`)
    act('git', ['clone', '--quiet', url, hub], config.hubsDir)
  }
  if (!hubState.ready) {
    if (!DRY && !existsSync(join(hub, 'scripts/setup.mjs'))) return notifyOnce(hubState, 'not-a-hub', name, `${name} has no scripts/setup.mjs, so it is not a factory hub. The worker skips it.`)
    log(`${name}: running setup`)
    if (!DRY) {
      const setup = sh('node', ['scripts/setup.mjs'], hub, { check: false })
      if (!setup.ok) return notifyOnce(hubState, 'setup-failed', name, `Setup of ${name} on ${HOST} failed:\n\n${(setup.err || setup.out).slice(-1500)}`)
    }
    hubState.ready = true
    notify(name, `${name} is ready on ${HOST}. The worker builds its ready change tasks from now on.`, hub)
  }

  // the main checkout follows origin and is never edited
  git(['fetch', '--quiet', 'origin'], hub)
  const branch = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], hub, { check: false }).out || 'origin/main'
  const dirty = git(['status', '--porcelain'], hub).out !== ''
  const behindOnly = git(['merge-base', '--is-ancestor', 'HEAD', branch], hub, { check: false }).ok
  if (dirty || !behindOnly) return notifyOnce(hubState, 'checkout', name, `The checkout of ${name} on ${HOST} has local changes or commits. The worker does not touch it, and builds nothing in it until it is clean.`)
  delete hubState.notified.checkout
  act('git', ['merge', '--quiet', '--ff-only', branch], hub)

  const tasks = readTasks(hub)
  const agents = DRY ? [] : JSON.parse(paseo(['ls', '-a', '--json']).out)
  // `paseo run --quiet` prints an id that a full id starts with
  const running = (id) => agents.some((agent) => id && agent.id.startsWith(id) && agent.status === 'running')

  cleanUp(hub, hubState, tasks, running)

  // one build at a time: a claimed task, or a session that is still running
  const claimed = tasks.find((task) => task.status === 'building')
  if (claimed) {
    const build = hubState.builds[claimed.id]
    // a build that never started was reported when it failed
    if (build?.agent && !running(build.agent)) {
      notifyOnce(hubState, `stale-${claimed.id}`, name, `${claimed.id} in ${name} is still "building", but its session on ${HOST} has ended. Look at the session, then set the task's status.`)
    }
    return
  }
  if (Object.values(hubState.builds).some((build) => running(build.agent))) return

  const task = nextTask(hub, tasks)
  if (!task) return
  build(name, hub, hubState, task, branch)
}

// ---- tasks ----------------------------------------------------------------------------------------------

function readTasks(hub) {
  const dir = join(hub, 'tasks')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => /^T-\d+-.*\.md$/.test(file))
    .map((file) => {
      const src = readFileSync(join(dir, file), 'utf8')
      const fm = src.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
      const meta = Object.fromEntries(fm.split('\n').map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]))
      const list = (v) => (v || '').replace(/[[\]"]/g, '').split(',').map((x) => x.trim()).filter(Boolean)
      return { id: meta.id, file, status: meta.status, repos: list(meta.repos), deps: list(meta.depends_on), number: Number(meta.id?.slice(2)) }
    })
    .filter((task) => task.id)
}

// the build skill's rule: ready, each dependency done, the lowest number first
function nextTask(hub, tasks) {
  const factory = JSON.parse(readFileSync(join(hub, 'factory.json'), 'utf8'))
  const allowed = factory.build?.repos
  const done = new Set(tasks.filter((task) => task.status === 'done').map((task) => task.id))
  return tasks
    .filter((task) => task.status === 'ready' && task.deps.every((dep) => done.has(dep)))
    .filter((task) => !allowed || task.repos.every((repo) => allowed.includes(repo)))
    .sort((a, b) => a.number - b.number)[0]
}

// ---- a build --------------------------------------------------------------------------------------------

function build(name, hub, hubState, task, branch) {
  const folder = join(hub, '.factory/builds', task.id)
  log(`${name}: building ${task.id} in ${folder}`)
  if (DRY) return log(`would claim ${task.id}, prepare ${folder} and start a session`)

  // the hub's worktree, on origin's main and detached: the build pushes with HEAD:main
  if (!existsSync(folder)) git(['worktree', 'add', '--quiet', '--detach', folder, branch], hub)
  else {
    git(['fetch', '--quiet', 'origin'], folder)
    git(['checkout', '--quiet', '--detach', branch], folder)
  }

  if (!claim(folder, task, branch)) {
    log(`${name}: ${task.id} was claimed elsewhere`)
    return removeBuild(hub, folder, task)
  }

  // after the claim, a failure leaves the task "building" with no session, so it is reported
  try {
    startBuild(name, hub, hubState, task, folder)
  } catch (error) {
    hubState.builds[task.id] = { agent: null, folder, started: new Date().toISOString() }
    notifyOnce(hubState, `start-${task.id}`, name, `${task.id} in ${name} is claimed, but its build could not start on ${HOST}:\n\n${error.message.slice(-1500)}\n\nFix the cause, then set the task back to "ready".`)
  }
}

function startBuild(name, hub, hubState, task, folder) {
  // a worktree of each repository of the task, on task/<id>
  const factory = JSON.parse(readFileSync(join(folder, 'factory.json'), 'utf8'))
  if (task.repos.some((repo) => !existsSync(join(hub, 'repos', repo)))) sh('npx', ['-y', '@dean0x/mars', 'clone'], hub)
  for (const repo of task.repos) {
    const main = join(hub, 'repos', repo)
    const tree = join(folder, 'repos', repo)
    const taskBranch = `task/${task.id}`
    git(['fetch', '--quiet', 'origin'], main)
    if (!existsSync(tree)) {
      const local = git(['rev-parse', '--verify', '--quiet', taskBranch], main, { check: false }).ok
      const remote = git(['rev-parse', '--verify', '--quiet', `origin/${taskBranch}`], main, { check: false }).ok
      const base = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], main, { check: false }).out || 'origin/main'
      if (local) git(['worktree', 'add', '--quiet', tree, taskBranch], main)
      else git(['worktree', 'add', '--quiet', '-b', taskBranch, tree, remote ? `origin/${taskBranch}` : base], main)
    }
    for (const file of factory.repos?.[repo]?.copy ?? []) {
      if (existsSync(join(main, file)) && !existsSync(join(tree, file))) cpSync(join(main, file), join(tree, file))
    }
    const setup = factory.repos?.[repo]?.setup
    if (setup) {
      const result = sh('sh', ['-c', setup], tree, { check: false })
      if (!result.ok) log(`${name}: setup of ${repo} for ${task.id} failed, the build continues:\n${result.err || result.out}`)
    }
  }

  const agent = paseo([
    'run', '--no-wait', '--quiet',
    '--cwd', folder,
    '--provider', factory.build?.provider ?? 'claude',
    // nobody answers prompts in a build: the classifier of auto mode approves or denies each tool
    '--mode', factory.build?.mode ?? 'auto',
    '--title', `${name} ${task.id}`,
    `Use the build skill to build ${task.id}. The worker claimed it for this run, so its status is building.`,
  ]).out
  hubState.builds[task.id] = { agent, folder, started: new Date().toISOString() }
  log(`${name}: started ${task.id} in session ${agent}`)
}

// sets the task to building on GitHub, so another machine does not build it too
function claim(folder, task, branch) {
  const path = join(folder, 'tasks', task.file)
  writeFileSync(path, readFileSync(path, 'utf8').replace(/^status: ready$/m, 'status: building'))
  git(['add', join('tasks', task.file)], folder)
  git(['commit', '--quiet', '-m', `chore: claim ${task.id} for a build on ${HOST}`], folder)
  for (let attempt = 0; attempt < 3; attempt++) {
    if (git(['push', '--quiet', 'origin', 'HEAD:main'], folder, { check: false }).ok) return true
    git(['fetch', '--quiet', 'origin'], folder)
    // a rebase that conflicts on the status line means someone else claimed the task
    if (!git(['rebase', '--quiet', branch], folder, { check: false }).ok) {
      git(['rebase', '--abort'], folder, { check: false })
      return false
    }
  }
  return false
}

// removes the build folders of finished tasks
function cleanUp(hub, hubState, tasks, running) {
  for (const [id, build] of Object.entries(hubState.builds)) {
    const task = tasks.find((t) => t.id === id)
    if (!['done', 'discarded'].includes(task?.status) || running(build.agent)) continue
    log(`${basename(hub)}: ${id} is ${task.status}, removing its build folder`)
    if (!DRY) removeBuild(hub, build.folder, task)
    delete hubState.builds[id]
  }
}

function removeBuild(hub, folder, task) {
  for (const repo of task.repos) {
    const tree = join(folder, 'repos', repo)
    if (existsSync(tree)) git(['worktree', 'remove', '--force', tree], join(hub, 'repos', repo), { check: false })
  }
  git(['worktree', 'remove', '--force', folder], hub, { check: false })
  rmSync(folder, { recursive: true, force: true })
}

// ---- messages -------------------------------------------------------------------------------------------

// a short Paseo session on the smallest model that only shows the message, so it reaches the phone.
// A message that cannot be sent stays in the log and does not stop the poll.
function notify(name, message, cwd = config.hubsDir) {
  log(`${name}: ${message.split('\n')[0]}`)
  if (DRY) return
  const sent = sh(config.paseo, [
    'run', '--no-wait', '--quiet', '--cwd', cwd,
    '--provider', config.notifyProvider ?? 'claude/claude-haiku-5-5',
    '--title', `${name}: factory worker`,
    `Reply with the message below, word for word, and nothing else. Do not use any tools.\n\n${message}`,
  ], HOME, { check: false })
  if (!sent.ok) log(`${name}: the message did not reach Paseo: ${sent.err || sent.out}`)
}

function notifyOnce(hubState, key, name, message) {
  if (hubState.notified[key]) return
  hubState.notified[key] = new Date().toISOString()
  notify(name, message)
}
