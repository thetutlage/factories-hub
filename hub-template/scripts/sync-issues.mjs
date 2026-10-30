// Mirrors hub tasks to GitHub issues, in the first repository of each task. A task takes part when its front
// matter has an `issue:` key. An empty `issue:` creates the issue and writes its URL back. A filled one updates
// the issue's title, body, milestone and `status: <status>` label, and closes it when the task is done or
// discarded. The hub task stays the source. Milestone titles come from `issues.milestones` in factory.json.
// The skills run it for their task after each change of its status.
//
//   node scripts/sync-issues.mjs T-009      sync these tasks
//   node scripts/sync-issues.mjs            sync every task
//   node scripts/sync-issues.mjs --dry-run  print what would change
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const HUB = new URL('..', import.meta.url).pathname
const DRY = process.argv.includes('--dry-run')
const IDS = process.argv.slice(2).filter((arg) => /^T-\d+$/.test(arg))
const STATUSES = ['draft', 'probing', 'ready', 'building', 'review', 'blocked', 'done', 'discarded']
const COLORS = {
  draft: 'd4d4d8',
  probing: 'c4b5fd',
  ready: '86efac',
  building: '93c5fd',
  review: 'fde047',
  blocked: 'fca5a5',
  done: 'a1a1aa',
  discarded: 'a1a1aa',
}

const MILESTONES = JSON.parse(readFileSync(join(HUB, 'factory.json'), 'utf8')).issues?.milestones ?? {}

// the repository of each name, from mars.yaml
const REPOS = Object.fromEntries(
  [...readFileSync(join(HUB, 'mars.yaml'), 'utf8').matchAll(/url: git@github\.com:([\w-]+\/([\w.-]+?))\.git/g)].map((m) => [m[2], m[1]])
)

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim()

function parse(file) {
  const src = readFileSync(file, 'utf8')
  const [, fm, body] = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  const meta = Object.fromEntries(fm.split('\n').map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]))
  const list = (v) => (v || '').replace(/[[\]"]/g, '').split(',').map((x) => x.trim()).filter(Boolean)
  return { file, src, meta, body, repo: REPOS[list(meta.repos)[0]], deps: list(meta.depends_on), title: body.match(/^# (.+)$/m)[1] }
}

const all = readdirSync(join(HUB, 'tasks'))
  .filter((f) => /^T-\d+-.*\.md$/.test(f))
  .map((f) => parse(join(HUB, 'tasks', f)))
  .filter((t) => 'issue' in t.meta && t.repo)
const byId = Object.fromEntries(all.map((t) => [t.meta.id, t]))
const tasks = IDS.length ? IDS.map((id) => byId[id]).filter(Boolean) : all

const missing = IDS.filter((id) => !byId[id])
if (missing.length) console.log(`no issue to sync for ${missing.join(', ')}`)

const milestoneCache = {}
function milestone(repo, key) {
  const title = MILESTONES[key]
  if (!title) return null
  milestoneCache[repo] ??= JSON.parse(gh('api', `repos/${repo}/milestones?state=all&per_page=100`))
  if (!milestoneCache[repo].some((m) => m.title === title)) {
    if (DRY) return title
    milestoneCache[repo].push(JSON.parse(gh('api', `repos/${repo}/milestones`, '-f', `title=${title}`)))
  }
  return title
}

// the label of a status, made in the repository the first time it is used
const labelCache = {}
function label(repo, status) {
  const name = `status: ${status}`
  labelCache[repo] ??= JSON.parse(gh('label', 'list', '-R', repo, '--limit', '200', '--json', 'name')).map((l) => l.name)
  if (!labelCache[repo].includes(name) && !DRY) {
    gh('label', 'create', name, '-R', repo, '--color', COLORS[status] ?? 'd4d4d8', '--description', 'The status of the hub task')
    labelCache[repo].push(name)
  }
  return name
}

// the issue body: the task without its front matter, title and context changes; dependencies as issue links
function issueBody(t) {
  let body = t.body.replace(/^# .+\n+/m, '').replace(/\n## Context changes[\s\S]*$/, '').trim()
  const deps = t.deps.map((id) => byId[id]?.meta.issue || id)
  if (deps.length) body += `\n\n## Depends on\n\n${deps.map((d) => `- ${d}`).join('\n')}`
  return `${body}\n\n---\nHub task \`${t.meta.id}\`. Edit the task in the hub, not this issue.\n`
}

// first pass: create the missing issues, so the second pass can link dependencies
for (const t of tasks.filter((t) => !t.meta.issue)) {
  const args = ['issue', 'create', '-R', t.repo, '-t', t.title, '-b', 'Syncing from the hub…']
  const ms = milestone(t.repo, t.meta.milestone)
  if (ms) args.push('-m', ms)
  if (DRY) { console.log('create', t.repo, t.meta.id, t.title); t.meta.issue = `(new ${t.meta.id})`; continue }
  t.meta.issue = gh(...args)
  writeFileSync(t.file, t.src.replace(/^issue:.*$/m, `issue: ${t.meta.issue}`))
  console.log('created', t.meta.id, t.meta.issue)
}

// second pass: the title, body, milestone and status label; closed when the task is finished
for (const t of tasks) {
  const status = STATUSES.includes(t.meta.status) ? t.meta.status : null
  if (DRY) { console.log('update', t.meta.id, t.meta.issue, status ? `status: ${status}` : '(no status)'); continue }
  const issue = JSON.parse(gh('issue', 'view', t.meta.issue, '--json', 'state,labels'))
  const args = ['issue', 'edit', t.meta.issue, '-t', t.title, '-b', issueBody(t)]
  const ms = milestone(t.repo, t.meta.milestone)
  if (ms) args.push('-m', ms)
  const want = status ? label(t.repo, status) : null
  const stale = issue.labels.map((l) => l.name).filter((name) => name.startsWith('status: ') && name !== want)
  if (want && !issue.labels.some((l) => l.name === want)) args.push('--add-label', want)
  if (stale.length) args.push('--remove-label', stale.join(','))
  gh(...args)
  const finished = ['done', 'discarded'].includes(t.meta.status)
  if (finished && issue.state === 'OPEN') gh('issue', 'close', t.meta.issue)
  if (!finished && issue.state === 'CLOSED') gh('issue', 'reopen', t.meta.issue)
  console.log('synced', t.meta.id, t.meta.issue, want ?? '(no status)')
}
