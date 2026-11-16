// The Dependabot pull requests of the repositories of mars.yaml. They are not change tasks: the import skips
// them (`github.import.skip` of factory.json). This script lists each open one with its checks. With --merge,
// it squash-merges each one whose checks all pass and that has no merge conflict. The person runs it.
//
//   node scripts/dependabot.mjs                 list them
//   node scripts/dependabot.mjs lucid redis     only these repositories
//   node scripts/dependabot.mjs --merge         merge the green ones
//   node scripts/dependabot.mjs --merge --dry-run
//
// A merge of one of them can give a conflict to the next one in the same repository. Dependabot rebases it,
// and a later run merges it.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const HUB = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const MERGE = process.argv.includes('--merge')
const DRY = process.argv.includes('--dry-run')
const ONLY = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))

const REPOS = [...readFileSync(join(HUB, 'mars.yaml'), 'utf8').matchAll(/url:\s*\S*github\.com[:/]([\w.-]+\/([\w.-]+?))(?:\.git)?\s*$/gm)]
  .map((m) => ({ name: m[2], slug: m[1] }))
  .filter((repo) => !ONLY.length || ONLY.includes(repo.name))

const QUERY = `query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { isArchived
  pullRequests(states: OPEN, first: 100) { nodes { url number title createdAt mergeable author { login }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } } }`

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim()

let green = 0
let merged = 0
let total = 0
for (const { name, slug } of REPOS) {
  const [owner, repo] = slug.split('/')
  const data = JSON.parse(gh('api', 'graphql', '-f', `query=${QUERY}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`)).data.repository
  if (data.isArchived) continue
  const prs = data.pullRequests.nodes.filter((pr) => /^dependabot/.test(pr.author?.login ?? ''))
  if (!prs.length) continue
  console.log(`\n${name}`)
  for (const pr of prs) {
    total++
    const checks = pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? 'NONE'
    const ok = checks === 'SUCCESS' && pr.mergeable === 'MERGEABLE'
    if (ok) green++
    const mark = ok ? 'green' : pr.mergeable === 'CONFLICTING' ? 'conflict' : `checks ${checks.toLowerCase()}`
    console.log(`  #${pr.number} ${pr.title} (${mark}, ${pr.createdAt.slice(0, 10)})`)
    if (!MERGE || !ok) continue
    if (DRY) {
      console.log(`    would merge ${pr.url}`)
      continue
    }
    const result = spawnSync('gh', ['pr', 'merge', pr.url, '--squash'], { encoding: 'utf8' })
    if (result.status === 0) {
      merged++
      console.log('    merged')
    } else {
      console.log(`    not merged: ${(result.stderr || result.stdout).trim().split('\n')[0]}`)
    }
  }
}
console.log(`\n${total} Dependabot pull requests, ${green} green${MERGE ? `, ${merged} merged` : ''}`)
