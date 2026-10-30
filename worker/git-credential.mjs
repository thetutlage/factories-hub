// A git credential helper: for `get` on github.com, it answers with an installation token of the factory's
// GitHub App for the owner of the repository. git calls it on each fetch and push. See github.mjs.
import { ownerOf, token } from './github.mjs'

if (process.argv[2] !== 'get') process.exit(0)

let input = ''
for await (const chunk of process.stdin) input += chunk
const request = Object.fromEntries(input.split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)))
if (request.host !== 'github.com') process.exit(0)

const owner = ownerOf(`github.com/${request.path ?? ''}`)
if (!owner) process.exit(0)
process.stdout.write(`username=x-access-token\npassword=${await token(owner)}\n`)
