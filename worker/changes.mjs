// The changes since the last triage, for a triage inside a build (state-machine.md, "Triage inside a
// build"). It prints one line for each change on the pull requests of the task, and nothing when there is
// no change. It records the start of this triage in state.json, so the watcher does not triage the same
// changes again. A poll of the worker writes all of state.json when it ends, so this script holds
// worker.lock while it reads, changes and saves the file.
//
//   node worker/changes.mjs <hub name> <task id>
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const [name, id] = process.argv.slice(2)
if (!name || !id) {
  console.error('usage: node worker/changes.mjs <hub name> <task id>')
  process.exit(1)
}

const lockPath = join(process.env.FACTORY_HOME ?? join(homedir(), '.factory'), 'worker.lock')
await lock()
try {
  // imported after the lock, because lib.mjs reads state.json when it loads
  const { config, readTasks, saveState, state } = await import('./lib.mjs')
  const { fingerprint, pullRequests } = await import('./watcher.mjs')
  const hub = join(config.hubsDir, name)
  const task = readTasks(hub).find((t) => t.id === id)
  if (!task) throw new Error(`${id} is not a task of ${hub}`)
  if (!state.hubs[name]) throw new Error(`the worker has no state for the hub ${name}`)

  const startedAt = new Date().toISOString()
  const prs = pullRequests(hub, task)?.filter((pr) => pr.state === 'OPEN')
  if (prs?.length) {
    const watch = ((state.hubs[name].watch ??= {})[id] ??= {})
    const { key, ids, changes } = fingerprint(hub, task, prs, watch.triagedAt)
    // a failed check or a merge conflict stays until the build pushes, so it is new only the first time
    const seen = new Set(JSON.parse(watch.triaged ?? '[]'))
    for (const [i, change] of changes.entries()) if (!seen.has(ids[i])) console.log(`- ${change}`)
    watch.triagedAt = startedAt
    watch.triaged = key
    delete watch.pending
    saveState()
  }
} finally {
  rmSync(lockPath, { force: true })
}

// waits while a poll of the worker holds the lock. A poll that starts while this script holds it is skipped.
async function lock() {
  for (let tries = 0; ; tries++) {
    try {
      return writeFileSync(lockPath, String(process.pid), { flag: 'wx' })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    if (!alive(lockPath)) {
      rmSync(lockPath, { force: true })
      continue
    }
    if (tries === 120) throw new Error('a poll of the worker has held worker.lock for 10 minutes')
    await sleep(5000)
  }
}

function alive(path) {
  try {
    process.kill(Number(readFileSync(path, 'utf8')), 0)
    return true
  } catch {
    return false
  }
}
