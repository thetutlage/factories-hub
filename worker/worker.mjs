// The factory worker: one poll of the fleet. launchd runs it every few minutes (see install.mjs).
// For each hub in the fleet's hubs.json, it clones and sets up the hub once, then runs the watcher, which
// moves the tasks in review (watcher.mjs), the builder, which builds the next ready task (builder.mjs), and
// keeps each pull request a draft while its task is reworked (drafts.mjs).
// state-machine.md gives the rules of both. A hub with nothing to do costs a `git fetch`, a look at the
// pull requests of each task in review, and no session.
//
//   node worker/worker.mjs            one poll
//   node worker/worker.mjs --dry-run  print what the poll would do
//
// FACTORY_HOME (default ~/.factory) holds config.json, state.json, the fleet clone and worker.log.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { builder } from './builder.mjs'
import { drafts } from './drafts.mjs'
import { DRY, HOME, HOST, act, config, git, log, readTasks, report, reportOnce, saveState, sessions, sh, state } from './lib.mjs'
import { watcher } from './watcher.mjs'

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
  saveState()
  if (!DRY) rmSync(lockPath, { force: true })
}

function poll() {
  updateSelf()

  // the sessions need the Paseo daemon. Quitting the desktop app can stop a daemon that it started, and
  // `daemon start` does nothing when one runs.
  if (!DRY) {
    const daemon = sh(config.paseo, ['daemon', 'start'], HOME, { check: false })
    if (daemon.out.startsWith('Started')) log(`started the Paseo daemon: ${daemon.out.split('\n')[0]}`)
  }

  // the fleet: a clone that only the worker reads
  const fleetDir = join(HOME, 'fleet')
  if (!existsSync(fleetDir)) git(['clone', '--quiet', config.fleet, fleetDir], HOME)
  else git(['pull', '--quiet', '--ff-only'], fleetDir)
  const urls = JSON.parse(readFileSync(join(fleetDir, 'hubs.json'), 'utf8'))

  for (const url of urls) {
    const name = basename(url).replace(/\.git$/, '')
    try {
      pollHub(url, name)
      delete state.hubs[name]?.notified['poll-failed']
    } catch (error) {
      log(`${url}: ${error.message}`)
      pollFailed(name, error)
    }
  }
}

// The worker's own checkout follows origin, so a fix pushed to this repository runs from the next poll: this
// poll has already loaded its code. A pull that fails, for example on local changes, is logged once for each
// new failure, and the worker goes on with the code it has.
function updateSelf() {
  const self = join(dirname(fileURLToPath(import.meta.url)), '..')
  if (DRY || !existsSync(join(self, '.git'))) return
  const before = git(['rev-parse', '--short', 'HEAD'], self, { check: false }).out
  const pulled = git(['pull', '--quiet', '--ff-only'], self, { check: false })
  if (!pulled.ok) {
    const failure = (pulled.err || pulled.out).split('\n')[0]
    if (state.selfUpdateFailure !== failure) log(`the worker could not update ${self}, and runs ${before}: ${failure}`)
    state.selfUpdateFailure = failure
    return
  }
  delete state.selfUpdateFailure
  const after = git(['rev-parse', '--short', 'HEAD'], self, { check: false }).out
  if (after !== before) log(`the worker updated ${self} from ${before} to ${after}. The next poll runs it`)
}

// A failed poll is reported once, and again after a poll of the hub works. The report is marked only when
// it reaches GitHub, so a failure while GitHub cannot be reached is reported on a later poll.
function pollFailed(name, error) {
  const hubState = state.hubs[name]
  if (!hubState || hubState.notified['poll-failed']) return
  const message = `The poll of \`${name}\` fails, so nothing is built, triaged or accepted. The worker tries again on each poll:\n\n\`\`\`\n${error.message.slice(-1500)}\n\`\`\``
  if (report(name, message)) hubState.notified['poll-failed'] = new Date().toISOString()
}

// ---- a hub ----------------------------------------------------------------------------------------------

function pollHub(url, name) {
  const hub = join(config.hubsDir, name)
  const hubState = (state.hubs[name] ??= { builds: {}, notified: {} })

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
    hubState.readyReported = report(name, `**Ready.** \`${name}\` is set up on \`${HOST}\` in \`${hub}\`. The worker builds its ready change tasks from now on.`, { problem: false })
  }

  // the main checkout follows origin and is never edited
  git(['fetch', '--quiet', 'origin'], hub)
  const branch = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], hub, { check: false }).out || 'origin/main'
  const dirty = git(['status', '--porcelain'], hub).out !== ''
  const behindOnly = git(['merge-base', '--is-ancestor', 'HEAD', branch], hub, { check: false }).ok
  if (dirty || !behindOnly) return reportOnce(hubState, 'checkout', name, `The checkout \`${hub}\` has local changes or commits. The worker does not touch it, and builds nothing in it until it is clean.`)
  delete hubState.notified.checkout
  act('git', ['merge', '--quiet', '--ff-only', branch], hub)

  // a read, so a dry run lists the sessions too
  const context = { name, hub, hubState, tasks: readTasks(hub), branch, running: sessions() }
  watcher(context)
  builder(context)
  // after both, so the draft state follows the statuses they set in this poll
  drafts({ ...context, tasks: readTasks(hub) })
}
