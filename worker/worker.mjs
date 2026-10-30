// The factory worker: one poll of the fleet. launchd runs it every few minutes (see install.mjs).
// For each hub in the fleet's hubs.json, it clones and sets up the hub once, then builds the next ready
// change task: it claims the task on GitHub, prepares a build folder of worktrees, and starts one Paseo
// session in it. A task in review is accepted when each of its pull requests is merged. A hub with nothing
// to build or accept costs a `git fetch`, a `gh pr list` for each task in review, and no session.
//
//   node worker/worker.mjs            one poll
//   node worker/worker.mjs --dry-run  print what the poll would do
//
// FACTORY_HOME (default ~/.factory) holds config.json, state.json, the fleet clone and worker.log.
import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, homedir } from 'node:os'
import { basename, join } from 'node:path'
import { env as githubEnv } from './github.mjs'

const HOME = process.env.FACTORY_HOME ?? join(homedir(), '.factory')
const DRY = process.argv.includes('--dry-run')
const HOST = hostname().replace(/\.local$/, '')
// how long review comments must be quiet before the worker sends a task back to build
const QUIET_MS = 5 * 60 * 1000

const config = JSON.parse(readFileSync(join(HOME, 'config.json'), 'utf8'))
// owner/name of the fleet repository on GitHub, or null for a fleet elsewhere
const FLEET_REPO = config.fleet.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? null
// with a GitHub App in the config, every git and gh call of the worker and its sessions uses the App
const SESSION_ENV = config.github ? githubEnv() : {}
Object.assign(process.env, SESSION_ENV)
const sessionEnv = Object.entries(SESSION_ENV).flatMap(([key, value]) => ['--env', `${key}=${value}`])

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
  hubState.accepts ??= {}

  if (!existsSync(hub)) {
    log(`${name}: new hub, cloning`)
    act('git', ['clone', '--quiet', url, hub], config.hubsDir)
  }
  if (!hubState.ready) {
    if (!DRY && !existsSync(join(hub, 'scripts/setup.mjs'))) return reportOnce(hubState, 'not-a-hub', name, `\`${name}\` has no \`scripts/setup.mjs\`, so it is not a factory hub. The worker skips it.`)
    log(`${name}: running setup`)
    if (!DRY) {
      const setup = sh('node', ['scripts/setup.mjs'], hub, { check: false })
      if (!setup.ok) return reportOnce(hubState, 'setup-failed', name, `The setup failed. The worker tries it again on each poll:\n\n\`\`\`\n${(setup.err || setup.out).slice(-1500)}\n\`\`\``)
    }
    hubState.ready = true
    delete hubState.notified['setup-failed']
  }
  // the hand-off, tried again on the next poll when GitHub cannot be reached
  if (!hubState.readyReported) {
    hubState.readyReported = report(hubState, name, `**Ready.** \`${name}\` is set up on \`${HOST}\` in \`${hub}\`. The worker builds its ready change tasks from now on.`, { problem: false })
  }

  // the main checkout follows origin and is never edited
  git(['fetch', '--quiet', 'origin'], hub)
  const branch = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], hub, { check: false }).out || 'origin/main'
  const dirty = git(['status', '--porcelain'], hub).out !== ''
  const behindOnly = git(['merge-base', '--is-ancestor', 'HEAD', branch], hub, { check: false }).ok
  if (dirty || !behindOnly) return reportOnce(hubState, 'checkout', name, `The checkout \`${hub}\` has local changes or commits. The worker does not touch it, and builds nothing in it until it is clean.`)
  delete hubState.notified.checkout
  act('git', ['merge', '--quiet', '--ff-only', branch], hub)

  const tasks = readTasks(hub)
  // a read, so a dry run lists the sessions too
  const agents = JSON.parse(paseo(['ls', '-a', '--json']).out)
  // `paseo run --quiet` prints an id that a full id starts with
  const running = (id) => agents.some((agent) => id && agent.id.startsWith(id) && agent.status === 'running')

  cleanUp(hub, hubState, tasks, running)

  // the tasks in review, next to the build: accepted once merged, back to draft when a pull request is closed
  for (const task of tasks.filter((t) => t.status === 'review')) {
    try {
      review(name, hub, hubState, task, branch, running)
    } catch (error) {
      log(`${name}: ${task.id}: ${error.message}`)
    }
  }

  // one build at a time: a claimed task, or a session that is still running
  const claimed = tasks.find((task) => task.status === 'building')
  if (claimed) {
    const build = hubState.builds[claimed.id]
    // a build that never started was reported when it failed
    if (build?.agent && !running(build.agent)) {
      reportOnce(hubState, `stale-${claimed.id}`, name, `${claimed.id} is still \`building\`, but its session has ended. Look at the session in Paseo, then set the task's status.`)
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
  // a new build of the task: its earlier reports may come again
  delete hubState.notified[`stale-${task.id}`]
  delete hubState.notified[`start-${task.id}`]

  // after the claim, a failure leaves the task "building" with no session, so it is reported
  try {
    startBuild(name, hub, hubState, task, folder)
  } catch (error) {
    hubState.builds[task.id] = { agent: null, folder, started: new Date().toISOString() }
    reportOnce(hubState, `start-${task.id}`, name, `${task.id} is claimed, but its build could not start:\n\n\`\`\`\n${error.message.slice(-1500)}\n\`\`\`\n\nFix the cause, then set the task back to \`ready\`.`)
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
    'run', '--no-wait', '--quiet', ...sessionEnv,
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
  return setStatus(folder, task, 'ready', 'building', `chore: claim ${task.id} for a build on ${HOST}`, branch)
}

// changes the status of a task in a hub worktree, pushes it, and syncs its issue when the hub has the script
function setStatus(folder, task, from, to, message, branch) {
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
    // a rebase that conflicts on the status line means someone else changed the status
    if (!git(['rebase', '--quiet', branch], folder, { check: false }).ok) {
      git(['rebase', '--abort'], folder, { check: false })
      return false
    }
  }
  return false
}

// ---- a review -------------------------------------------------------------------------------------------

// owner/name of each repository of the hub, from mars.yaml
function repoSlugs(hub) {
  const yaml = readFileSync(join(hub, 'mars.yaml'), 'utf8')
  return Object.fromEntries(
    [...yaml.matchAll(/url:\s*\S*github\.com[:/]([\w.-]+\/([\w.-]+?))(?:\.git)?\s*$/gm)].map((m) => [m[2], m[1]])
  )
}

// the newest pull request of task/<id> in each repository of the task, or null when one is missing
function pullRequests(hub, task) {
  const slugs = repoSlugs(hub)
  const prs = []
  for (const repo of task.repos) {
    if (!slugs[repo]) return null
    const list = sh('gh', ['pr', 'list', '--repo', slugs[repo], '--head', `task/${task.id}`, '--state', 'all', '--limit', '1', '--json', 'number,state,url'], hub)
    const pr = JSON.parse(list.out)[0]
    if (!pr) return null
    prs.push({ ...pr, repo: slugs[repo] })
  }
  return prs
}

function review(name, hub, hubState, task, branch, running) {
  const accept = hubState.accepts[task.id]
  if (accept) {
    if (!running(accept.agent)) {
      reportOnce(hubState, `stale-accept-${task.id}`, name, `${task.id} is merged, but its accept session has ended and the task is still \`review\`. Look at the session in Paseo, then run the accept skill for it.`)
    }
    return
  }
  const prs = pullRequests(hub, task)
  if (!prs) return
  if (prs.some((pr) => pr.state === 'OPEN')) return rebuild(name, hub, task, branch, prs)

  const closed = prs.filter((pr) => pr.state === 'CLOSED')
  if (closed.length) return reopen(name, hub, hubState, task, branch, closed)
  if (DRY) return log(`would accept ${task.id}: ${prs.map((pr) => pr.url).join(', ')}`)

  // a worktree of the hub for the accept session, which pushes with HEAD:main
  const folder = join(hub, '.factory/accepts', task.id)
  if (!existsSync(folder)) git(['worktree', 'add', '--quiet', '--detach', folder, branch], hub)
  else {
    git(['fetch', '--quiet', 'origin'], folder)
    git(['checkout', '--quiet', '--detach', branch], folder)
  }
  const factory = JSON.parse(readFileSync(join(folder, 'factory.json'), 'utf8'))
  const agent = paseo([
    'run', '--no-wait', '--quiet', ...sessionEnv,
    '--cwd', folder,
    '--provider', factory.build?.provider ?? 'claude',
    '--mode', factory.build?.mode ?? 'auto',
    '--title', `${name} accept ${task.id}`,
    `Use the accept skill for ${task.id}. The person merged each of its pull requests: ${prs.map((pr) => pr.url).join(', ')}.`,
  ]).out
  hubState.accepts[task.id] = { agent, folder, started: new Date().toISOString() }
  log(`${name}: ${task.id} is merged, started its accept in session ${agent}`)
}

// a pull request closed with no merge: the task goes back to draft, and the person decides what is next
function reopen(name, hub, hubState, task, branch, closed) {
  const key = `closed-${task.id}-${closed.map((pr) => pr.number).join('-')}`
  if (hubState.notified[key]) return
  if (DRY) return log(`would set ${task.id} back to draft: ${closed.map((pr) => pr.url).join(', ')} closed`)
  const changed = changeStatus(hub, task, branch, 'review', 'draft', `chore: set ${task.id} back to draft, its pull request was closed`)
  if (!changed) return
  reportOnce(hubState, key, name, `${task.id}: ${closed.map((pr) => pr.url).join(', ')} was closed with no merge. The worker set the task back to \`draft\`. Change it and probe it again, or discard it.`)
}

// review comments on an open pull request: once they are quiet, the task goes back to ready, and the next
// build reads them. The build replies before it sets the task to review, so its replies do not count.
function rebuild(name, hub, task, branch, prs) {
  const comments = newComments(hub, task, prs)
  if (!comments.length) return
  const newest = Math.max(...comments.map((comment) => Date.parse(comment.createdAt)))
  if (Date.now() - newest < QUIET_MS) return
  if (DRY) return log(`would send ${task.id} back to build for ${comments.length} review comments`)
  const message = `chore: send ${task.id} back to build for ${comments.length} review comments`
  if (changeStatus(hub, task, branch, 'review', 'ready', message)) log(`${name}: ${message}`)
}

// the comments of unresolved review threads that came after the task was set to review
function newComments(hub, task, prs) {
  const since = Date.parse(git(['log', '-1', '--format=%cI', '-G', '^status: review$', '--', join('tasks', task.file)], hub).out)
  if (Number.isNaN(since)) return []
  const query = 'query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100) { nodes { isResolved comments(last: 50) { nodes { createdAt } } } } } } }'
  const comments = []
  for (const pr of prs.filter((pr) => pr.state === 'OPEN')) {
    const [owner, repo] = pr.repo.split('/')
    const out = sh('gh', ['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`, '-F', `number=${pr.number}`], hub).out
    for (const thread of JSON.parse(out).data.repository.pullRequest.reviewThreads.nodes) {
      if (!thread.isResolved) comments.push(...thread.comments.nodes.filter((comment) => Date.parse(comment.createdAt) > since))
    }
  }
  return comments
}

// changes the status of a task in a short-lived worktree of the hub
function changeStatus(hub, task, branch, from, to, message) {
  const folder = join(hub, '.factory/status', task.id)
  if (existsSync(folder)) git(['worktree', 'remove', '--force', folder], hub, { check: false })
  git(['worktree', 'add', '--quiet', '--detach', folder, branch], hub)
  try {
    return setStatus(folder, task, from, to, message, branch)
  } finally {
    git(['worktree', 'remove', '--force', folder], hub, { check: false })
  }
}

// removes the build and accept folders of finished tasks
function cleanUp(hub, hubState, tasks, running) {
  for (const kind of ['builds', 'accepts']) {
    for (const [id, entry] of Object.entries(hubState[kind])) {
      const task = tasks.find((t) => t.id === id)
      if (!['done', 'discarded'].includes(task?.status) || running(entry.agent)) continue
      log(`${basename(hub)}: ${id} is ${task.status}, removing its ${kind === 'builds' ? 'build' : 'accept'} folder`)
      if (!DRY) removeBuild(hub, entry.folder, task)
      delete hubState[kind][id]
    }
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

// ---- the hand-off -------------------------------------------------------------------------------------

// One issue in the fleet repository for each hub on each machine. The worker opens it with the first
// report, and comments on it after that. A problem reopens it; a person closes it when it is handled.
// A report that cannot reach GitHub stays in the log, returns false, and does not stop the poll.
function report(hubState, name, message, { problem = true } = {}) {
  log(`${name}: ${message.split('\n')[0]}`)
  if (DRY) return false
  if (!FLEET_REPO) return true
  const gh = (args) => sh('gh', [...args, '--repo', FLEET_REPO], HOME, { check: false })
  if (!hubState.issue) {
    const created = gh(['issue', 'create', '--title', `${name} on ${HOST}`, '--body', message])
    if (!created.ok) return log(`${name}: the report did not reach GitHub: ${created.err || created.out}`) ?? false
    hubState.issue = Number(created.out.match(/\/issues\/(\d+)/)?.[1])
    return true
  }
  const commented = gh(['issue', 'comment', String(hubState.issue), '--body', message])
  if (!commented.ok) return log(`${name}: the report did not reach GitHub: ${commented.err || commented.out}`) ?? false
  if (problem) gh(['issue', 'reopen', String(hubState.issue)])
  return true
}

function reportOnce(hubState, key, name, message) {
  if (hubState.notified[key]) return
  hubState.notified[key] = new Date().toISOString()
  report(hubState, name, message)
}
