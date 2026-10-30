// Runs the real gh with an installation token of the factory's GitHub App. bin/gh calls it, and env() of
// github.mjs puts bin/ first on the PATH. The owner of the token comes from the first of: a --repo or -R
// value, a GitHub URL, a repos/<owner>/ path of `gh api`, an owner= field of `gh api graphql`, and the
// origin remote of the current folder.
import { spawnSync } from 'node:child_process'
import { app, ownerOf, token } from './github.mjs'

const args = process.argv.slice(2)

function owner() {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--repo' || arg === '-R') return ownerOf(args[i + 1])
    if (arg.startsWith('--repo=')) return ownerOf(arg.slice(7))
  }
  for (const arg of args) {
    const found = ownerOf(arg) ?? arg.match(/^\/?repos\/([^/]+)\//)?.[1] ?? arg.match(/^owner=([\w.-]+)$/)?.[1]
    if (found && /github\.com|^\/?repos\/|^owner=/.test(arg)) return found
  }
  const origin = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' })
  return origin.status === 0 ? ownerOf(origin.stdout.trim()) : null
}

const who = owner()
if (!who) {
  console.error('gh (factory): no repository owner in the arguments or the origin remote, so no token of the GitHub App')
  process.exit(1)
}
const result = spawnSync(app().gh, args, { stdio: 'inherit', env: { ...process.env, GH_TOKEN: await token(who) } })
process.exit(result.status ?? 1)
