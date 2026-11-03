// The draft state of the pull requests, by the rules of "Drafts" in state-machine.md. A pull request of a
// task that is `ready`, `building` or `blocked` is a draft, so that GitHub turns off its merge button while
// the factory reworks it or waits on the person. A pull request of a task in `review` is ready for review.
// A draft and its undo are not a change for the watcher, so they start no triage.
import { act, log, sh } from './lib.mjs'

const DRAFT = new Set(['ready', 'building', 'blocked'])

export function drafts({ name, hub, tasks }) {
  for (const task of tasks.filter((t) => t.prs.length && (DRAFT.has(t.status) || t.status === 'review'))) {
    const draft = DRAFT.has(task.status)
    for (const url of task.prs) {
      try {
        const pr = sh('gh', ['pr', 'view', url, '--json', 'state,isDraft'], hub, { check: false })
        if (!pr.ok) continue
        const { state, isDraft } = JSON.parse(pr.out)
        if (state !== 'OPEN' || isDraft === draft) continue
        log(`${name}: ${task.id} is ${task.status}, marking ${url} ${draft ? 'as a draft' : 'ready for review'}`)
        act('gh', ['pr', 'ready', url, ...(draft ? ['--undo'] : [])], hub)
      } catch (error) {
        log(`${name}: ${task.id}: ${url}: ${error.message}`)
      }
    }
  }
}
