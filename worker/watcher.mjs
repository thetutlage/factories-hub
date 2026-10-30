// The watcher: looks at the pull requests of each change task in `review`, by the rules of "The watcher
// script" in state-machine.md. Each pull request merged: the task goes to `accepting`, and an accept
// session starts. A pull request closed with no merge: the task goes back to `draft`. A change on an open
// pull request: once it is 5 minutes old, a triage session starts. The activity of the factory itself is
// not a change, so the replies and comments of its own sessions do not start a triage.
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { DRY, FACTORY_LOGIN, changeStatus, git, hubWorktree, log, removeFolder, reportIssue, reportOnce, repoSlugs, sh, startSession } from './lib.mjs'

const QUIET_MS = 5 * 60 * 1000
const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'NEUTRAL', 'ERROR'])

export function watcher(context) {
  const { hubState, tasks } = context
  hubState.accepts ??= {}
  hubState.watch ??= {}
  cleanUp(context)
  for (const task of tasks.filter((t) => t.status === 'review' || t.status === 'accepting')) {
    try {
      if (task.status === 'review') review(context, task)
      else accepting(context, task)
    } catch (error) {
      log(`${context.name}: ${task.id}: ${error.message}`)
    }
  }
}

function review(context, task) {
  const { name, hub, hubState, branch } = context
  const prs = pullRequests(hub, task)
  if (!prs) return

  const open = prs.filter((pr) => pr.state === 'OPEN')
  if (open.length) return triage(context, task, open)

  const closed = prs.filter((pr) => pr.state === 'CLOSED')
  if (closed.length) {
    const key = `closed-${task.id}-${closed.map((pr) => pr.number).join('-')}`
    if (hubState.notified[key]) return
    if (!changeStatus(hub, task, branch, 'review', 'draft', `chore: set ${task.id} back to draft, its pull request was closed`)) return
    return reportOnce(hubState, key, name, `${task.id}: ${closed.map((pr) => pr.url).join(', ')} was closed with no merge. The worker set the task back to \`draft\`. Change it and probe it again, or discard it.`)
  }

  if (!changeStatus(hub, task, branch, 'review', 'accepting', `chore: accept ${task.id}, each of its pull requests is merged`)) return
  startAccept(context, task, prs)
}

// a task in accepting: its accept session runs, or ended, or never started on this machine
function accepting(context, task) {
  const { name, hubState, running } = context
  const accept = hubState.accepts[task.id]
  if (!accept) {
    const prs = pullRequests(context.hub, task)
    if (prs) startAccept(context, task, prs)
    return
  }
  if (!running(accept.agent)) {
    reportOnce(hubState, `stale-accept-${task.id}`, name, `${task.id} is still \`accepting\`, but its accept session has ended. Look at the session in Paseo, then run the accept skill for it.`)
  }
}

function startAccept({ name, hub, hubState, branch }, task, prs) {
  const folder = join(hub, '.factory/accepts', task.id)
  if (DRY) return log(`would accept ${task.id}: ${prs.map((pr) => pr.url).join(', ')}`)
  hubWorktree(hub, folder, branch)
  const agent = startSession(folder, `${name} accept ${task.id}`, `Use the accept skill for ${task.id}. The person merged each of its pull requests: ${prs.map((pr) => pr.url).join(', ')}. Its status is accepting.`)
  hubState.accepts[task.id] = { agent, folder, started: new Date().toISOString() }
  log(`${name}: ${task.id} is merged, started its accept in session ${agent}`)
}

// ---- triage ---------------------------------------------------------------------------------------------

function triage({ name, hub, hubState, branch, running }, task, prs) {
  const watch = (hubState.watch[task.id] ??= {})
  if (watch.agent && running(watch.agent)) return

  const { key, changes } = fingerprint(hub, task, prs)
  if (!changes.length || key === watch.triaged) return delete watch.pending
  // the change must stay the same for 5 minutes, so a person who writes several comments is not cut off
  if (watch.pending?.key !== key) return void (watch.pending = { key, since: Date.now() })
  if (Date.now() - watch.pending.since < QUIET_MS) return

  const folder = join(hub, '.factory/triage', task.id)
  log(`${name}: triage of ${task.id} for ${changes.length} changes`)
  if (DRY) return log(`would start triage of ${task.id}:\n${changes.map((change) => `  - ${change}`).join('\n')}`)
  hubWorktree(hub, folder, branch)
  const issue = reportIssue(hubState)
  const prompt = [
    `Use the triage skill for ${task.id}. Its pull requests: ${prs.map((pr) => pr.url).join(', ')}.`,
    'The changes since the last triage:',
    ...changes.map((change) => `- ${change}`),
    issue ? `Report a fault outside the task on ${issue}.` : '',
  ].filter(Boolean).join('\n')
  watch.agent = startSession(folder, `${name} triage ${task.id}`, prompt)
  watch.triaged = key
  delete watch.pending
  log(`${name}: started the triage of ${task.id} in session ${watch.agent}`)
}

const PR_QUERY = `query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
  mergeable
  reviews(last: 50) { nodes { id url state submittedAt author { login } } }
  comments(last: 50) { nodes { id url createdAt author { login } } }
  reviewThreads(last: 100) { nodes { comments(last: 20) { nodes { id url createdAt author { login } } } } }
  commits(last: 1) { nodes { commit { oid committedDate author { user { login } }
    statusCheckRollup { contexts(first: 100) { nodes { __typename ... on CheckRun { name conclusion detailsUrl } ... on StatusContext { context state targetUrl } } } } } } }
} } }`

// What changed on the pull requests since the task was set to review, without the factory's own activity:
// reviews, comments, a commit of a person, failed checks of the head commit, and a merge conflict. The key
// is the same while nothing new comes.
export function fingerprint(hub, task, prs) {
  const since = Date.parse(git(['log', '-1', '--format=%cI', '-G', '^status: review$', '--', join('tasks', task.file)], hub).out) || 0
  const isPerson = (author) => author && author.login.replace(/\[bot\]$/, '') !== FACTORY_LOGIN
  const ids = []
  const changes = []
  for (const pr of prs) {
    const [owner, repo] = pr.repo.split('/')
    const out = sh('gh', ['api', 'graphql', '-f', `query=${PR_QUERY}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`, '-F', `number=${pr.number}`], hub).out
    const data = JSON.parse(out).data.repository.pullRequest

    const activity = [
      ...data.reviews.nodes.filter((r) => r.state !== 'PENDING').map((r) => ({ ...r, at: r.submittedAt, kind: `a review (${r.state.toLowerCase()})` })),
      ...data.comments.nodes.map((c) => ({ ...c, at: c.createdAt, kind: 'a comment' })),
      ...data.reviewThreads.nodes.flatMap((t) => t.comments.nodes).map((c) => ({ ...c, at: c.createdAt, kind: 'a review comment' })),
    ]
    for (const item of activity) {
      if (!isPerson(item.author) || Date.parse(item.at) <= since) continue
      ids.push(item.id)
      changes.push(`${item.kind} by ${item.author.login}: ${item.url}`)
    }

    const commit = data.commits.nodes[0]?.commit
    if (!commit) continue
    const committer = commit.author?.user
    if (committer && isPerson(committer) && Date.parse(commit.committedDate) > since) {
      ids.push(commit.oid)
      changes.push(`a commit by ${committer.login} on ${pr.url}: ${commit.oid.slice(0, 7)}`)
    }
    for (const check of commit.statusCheckRollup?.contexts.nodes ?? []) {
      const result = check.__typename === 'CheckRun' ? check.conclusion : check.state
      if (!FAILED.has(result)) continue
      const label = check.name ?? check.context
      ids.push(`${commit.oid}:${label}:${result}`)
      changes.push(`the check "${label}" is ${result.toLowerCase()} on ${commit.oid.slice(0, 7)}: ${check.detailsUrl ?? check.targetUrl ?? pr.url}`)
    }
    if (data.mergeable === 'CONFLICTING') {
      ids.push(`${commit.oid}:conflict`)
      changes.push(`${pr.url} has a merge conflict with its base branch`)
    }
  }
  return { key: JSON.stringify(ids.sort()), changes }
}

// ---- pull requests --------------------------------------------------------------------------------------

// the pull requests of the task: `pull_requests` of the task, or the newest pull request of task/<id> in
// each repository of the task. null when one is missing.
export function pullRequests(hub, task) {
  if (task.prs.length) {
    return task.prs.map((url) => {
      const pr = JSON.parse(sh('gh', ['pr', 'view', url, '--json', 'number,state,url'], hub).out)
      return { ...pr, repo: url.match(/github\.com\/([^/]+\/[^/]+)\//)[1] }
    })
  }
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

// removes the accept folders of finished tasks, and the triage folders of tasks that left review
function cleanUp({ hub, hubState, tasks, running }) {
  for (const [id, accept] of Object.entries(hubState.accepts)) {
    const task = tasks.find((t) => t.id === id)
    if (!['done', 'discarded'].includes(task?.status) || running(accept.agent)) continue
    log(`${basename(hub)}: ${id} is ${task.status}, removing its accept folder`)
    if (!DRY) removeFolder(hub, accept.folder, task)
    delete hubState.accepts[id]
  }
  for (const [id, watch] of Object.entries(hubState.watch)) {
    const task = tasks.find((t) => t.id === id)
    if (task?.status === 'review' || running(watch.agent)) continue
    const folder = join(hub, '.factory/triage', id)
    if (!DRY && existsSync(folder)) removeFolder(hub, folder, task)
    delete watch.agent
    if (!task || ['done', 'discarded'].includes(task.status)) delete hubState.watch[id]
  }
}
