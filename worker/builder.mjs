// The builder: takes the next `ready` change task of a hub by the rule of "Build" in state-machine.md,
// claims it on GitHub, prepares a build folder of worktrees, and starts one Paseo session in it with the
// build skill. One build at a time in each hub.
import { cpSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { DRY, HOST, factoryOf, git, hubWorktree, log, removeFolder, reportOnce, setStatus, sh, startSession } from './lib.mjs'

export function builder({ name, hub, hubState, tasks, branch, running }) {
  cleanUp(hub, hubState, tasks, running)

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
  if (task) build(name, hub, hubState, task, branch)
}

// rework first, then the lowest number; each dependency done, and only the repositories of build.repos
function nextTask(hub, tasks) {
  const allowed = factoryOf(hub).build?.repos
  const done = new Set(tasks.filter((task) => task.status === 'done').map((task) => task.id))
  return tasks
    .filter((task) => task.status === 'ready' && task.deps.every((dep) => done.has(dep)))
    .filter((task) => !allowed || task.repos.every((repo) => allowed.includes(repo)))
    .sort((a, b) => Number(b.rework) - Number(a.rework) || a.number - b.number)[0]
}

function build(name, hub, hubState, task, branch) {
  const folder = join(hub, '.factory/builds', task.id)
  log(`${name}: building ${task.id}${task.rework ? ' (rework)' : ''} in ${folder}`)
  if (DRY) return log(`would claim ${task.id}, prepare ${folder} and start a session`)

  hubWorktree(hub, folder, branch)
  if (!setStatus(folder, task, 'ready', 'building', `chore: claim ${task.id} for a build on ${HOST}`, branch)) {
    log(`${name}: ${task.id} was claimed elsewhere`)
    return removeFolder(hub, folder, task)
  }
  // a new build of the task: its earlier reports may come again
  delete hubState.notified[`stale-${task.id}`]
  delete hubState.notified[`start-${task.id}`]

  // after the claim, a failure leaves the task "building" with no session, so it is reported
  try {
    prepare(name, hub, task, folder)
    const agent = startSession(folder, `${name} ${task.id}`, `Use the build skill to build ${task.id}. The worker claimed it for this run, so its status is building.`)
    hubState.builds[task.id] = { agent, folder, started: new Date().toISOString() }
    log(`${name}: started ${task.id} in session ${agent}`)
  } catch (error) {
    hubState.builds[task.id] = { agent: null, folder, started: new Date().toISOString() }
    reportOnce(hubState, `start-${task.id}`, name, `${task.id} is claimed, but its build could not start:\n\n\`\`\`\n${error.message.slice(-1500)}\n\`\`\`\n\nFix the cause, then set the task back to \`ready\`.`)
  }
}

// a worktree of each repository of the task on task/<id>, with the copied files and the setup of factory.json
function prepare(name, hub, task, folder) {
  const factory = factoryOf(folder)
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
}

// removes the build folders of finished tasks
function cleanUp(hub, hubState, tasks, running) {
  for (const [id, build] of Object.entries(hubState.builds)) {
    const task = tasks.find((t) => t.id === id)
    if (!['done', 'discarded'].includes(task?.status) || running(build.agent)) continue
    log(`${basename(hub)}: ${id} is ${task.status}, removing its build folder`)
    if (!DRY) removeFolder(hub, build.folder, task)
    delete hubState.builds[id]
  }
}
