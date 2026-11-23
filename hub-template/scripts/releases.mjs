// The work that is merged and not released yet, for each repository of mars.yaml that publishes releases on
// GitHub. For each one it prints the commits since its latest release, the bump they need, and the order of
// the releases when one package of the hub depends on another. The release skill reads it. It changes nothing.
//
//   node scripts/releases.mjs              each repository with work to release
//   node scripts/releases.mjs lucid ace    only these repositories
//   node scripts/releases.mjs --json       the same, as JSON
//
// The bump comes from the conventional commit messages: a breaking change (`!:` or `BREAKING CHANGE`) is a
// major, `feat` a minor, and `fix` and `perf` a patch. Other commits, such as `chore`, `docs`, `test`, `ci` and
// `refactor`, need no release by themselves. A `chore(deps)` commit is marked `deps`: it needs a patch only when
// it changes a dependency that the package publishes, not a GitHub Action or the lockfile alone, so the release
// skill decides. The order uses `dependencies` and `peerDependencies` only.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const HUB = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const JSON_OUT = process.argv.includes('--json')
const ONLY = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))

// The name of a repository is its `path:` in mars.yaml, or the name in its URL. It is its folder in repos/.
const REPOS = readFileSync(join(HUB, 'mars.yaml'), 'utf8')
  .split(/^\s*-\s+(?=url:)/m)
  .slice(1)
  .flatMap((entry) => {
    const url = entry.match(/url:\s*\S*github\.com[:/]([\w.-]+\/([\w.-]+?))(?:\.git)?\s*$/m)
    return url ? [{ name: entry.match(/^\s*path:\s*(\S+)/m)?.[1] ?? url[2], slug: url[1] }] : []
  })
  .filter((repo) => !ONLY.length || ONLY.includes(repo.name))

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const tryGh = (...args) => {
  try {
    return gh(...args)
  } catch {
    return null
  }
}

const BUMPS = ['none', 'patch', 'minor', 'major']

function bumpOf(message) {
  const [subject] = message.split('\n')
  if (/^\w+(\([^)]*\))?!:/.test(subject) || /^BREAKING CHANGE/m.test(message)) return 'major'
  if (/^feat(\([^)]*\))?:/.test(subject)) return 'minor'
  if (/^(fix|perf)(\([^)]*\))?:/.test(subject)) return 'patch'
  if (/^chore\(deps\):/.test(subject) && !/ actions\/|\.github\/workflows/.test(subject)) return 'deps'
  return 'none'
}

const pending = []
for (const { name, slug } of REPOS) {
  const repo = JSON.parse(gh('api', `repos/${slug}`))
  if (repo.archived) continue
  const latest = tryGh('api', `repos/${slug}/releases/latest`)
  if (!latest) continue
  const release = JSON.parse(latest)
  const compare = JSON.parse(gh('api', `repos/${slug}/compare/${release.tag_name}...${repo.default_branch}`))
  const commits = compare.commits
    .map((c) => ({ sha: c.sha.slice(0, 7), subject: c.commit.message.split('\n')[0], bump: bumpOf(c.commit.message) }))
    .filter((c) => !/^chore\(release\)|^Merge (pull request|branch)/.test(c.subject))
  const bump = commits.reduce((max, c) => (BUMPS.indexOf(c.bump) > BUMPS.indexOf(max) ? c.bump : max), 'none')
  const deps = commits.some((c) => c.bump === 'deps')
  if (bump === 'none' && !deps) continue

  const pkg = tryGh('api', `repos/${slug}/contents/package.json?ref=${repo.default_branch}`, '-H', 'Accept: application/vnd.github.raw')
  const manifest = pkg ? JSON.parse(pkg) : {}
  pending.push({
    name,
    slug,
    package: manifest.name ?? name,
    deps: Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }),
    branch: repo.default_branch,
    latest: release.tag_name,
    releasedAt: release.published_at.slice(0, 10),
    bump: bump === 'none' ? 'deps' : bump,
    commits,
  })
}

// the order: a package goes after each pending package that it depends on
const byPackage = new Map(pending.map((p) => [p.package, p]))
const ordered = []
const visit = (p, seen = new Set()) => {
  if (ordered.includes(p) || seen.has(p)) return
  seen.add(p)
  for (const dep of p.deps) if (byPackage.has(dep)) visit(byPackage.get(dep), seen)
  ordered.push(p)
}
for (const p of pending) visit(p)
for (const p of ordered) p.after = p.deps.filter((dep) => byPackage.has(dep))

if (JSON_OUT) {
  console.log(JSON.stringify(ordered.map(({ deps, ...p }) => p), null, 2))
} else if (!ordered.length) {
  console.log('Nothing to release')
} else {
  for (const p of ordered) {
    const after = p.after.length ? `, after ${p.after.join(', ')}` : ''
    console.log(`\n${p.package}: ${p.bump}${after} (${p.latest} of ${p.releasedAt}, ${p.slug} ${p.branch})`)
    for (const c of p.commits) console.log(`  ${c.sha} ${c.subject}${c.bump === 'none' ? '' : `  [${c.bump}]`}`)
  }
  console.log('\nA bump of "deps" means only dependency updates: release when one changes a published dependency.')
}
