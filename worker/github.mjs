// The factory's identity on GitHub: a GitHub App. A JWT signed with the App's private key is exchanged for
// an installation token of the account that owns a repository. Tokens are cached in FACTORY_HOME/github/
// until 5 minutes before they expire, so each git and gh call gets a valid one, however long a build runs.
// git gets its tokens from git-credential.mjs, and gh from bin/gh. env() gives the environment that sends
// both through them, with the App as the author of commits.
import { createSign } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = process.env.FACTORY_HOME ?? join(homedir(), '.factory')
const CACHE = join(HOME, 'github', 'tokens.json')
const HERE = new URL('.', import.meta.url).pathname

export function app() {
  return JSON.parse(readFileSync(join(HOME, 'config.json'), 'utf8')).github
}

const base64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')

// valid for 9 minutes, and dated 1 minute back for a clock that runs fast
function jwt({ appId, key }) {
  const now = Math.floor(Date.now() / 1000)
  const body = `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url({ iat: now - 60, exp: now + 540, iss: String(appId) })}`
  return `${body}.${createSign('RSA-SHA256').update(body).sign(readFileSync(key, 'utf8'), 'base64url')}`
}

export async function api(path, { method = 'GET', bearer } = {}) {
  const headers = { 'accept': 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'factories-hub' }
  if (bearer) headers.authorization = `Bearer ${bearer}`
  const response = await fetch(`https://api.github.com${path}`, { method, headers })
  if (!response.ok) throw new Error(`GitHub ${method} ${path} answered ${response.status}: ${await response.text()}`)
  return response.json()
}

export async function appInfo(config) {
  return api('/app', { bearer: jwt(config) })
}

// an installation token for the account that owns the repositories, minted when the cached one is old
export async function token(owner) {
  const config = app()
  const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}
  const cached = cache[owner.toLowerCase()]
  if (cached && Date.parse(cached.expiresAt) - Date.now() > 5 * 60 * 1000) return cached.token

  const bearer = jwt(config)
  const installation = cached?.installation ?? (await installationOf(owner, bearer))
  const minted = await api(`/app/installations/${installation}/access_tokens`, { method: 'POST', bearer })
  cache[owner.toLowerCase()] = { installation, token: minted.token, expiresAt: minted.expires_at }

  // written to a new file and renamed, so a git call that reads the cache never sees half a file
  mkdirSync(join(HOME, 'github'), { recursive: true, mode: 0o700 })
  const temporary = `${CACHE}.${process.pid}`
  writeFileSync(temporary, JSON.stringify(cache, null, 2), { mode: 0o600 })
  renameSync(temporary, CACHE)
  return minted.token
}

async function installationOf(owner, bearer) {
  for (const kind of ['orgs', 'users']) {
    try {
      return (await api(`/${kind}/${owner}/installation`, { bearer })).id
    } catch {}
  }
  throw new Error(`The GitHub App ${app().slug} is not installed on ${owner}. Install it on the repositories of ${owner}.`)
}

// owner of a repository in a git URL, a GitHub URL or an owner/name pair
export function ownerOf(text) {
  return text?.match(/github\.com[:/]([^/\s]+)\//)?.[1] ?? text?.match(/^([\w.-]+)\/[\w.-]+$/)?.[1] ?? null
}

// the environment of the worker and its sessions: gh and git use the App, over HTTPS, with no SSH key
export function env(path = process.env.PATH) {
  const { slug, botId } = app()
  const helper = `!node '${join(HERE, 'git-credential.mjs')}'`
  const git = [
    // an empty helper first, so that git asks no other helper, such as the keychain of the person
    ['credential.helper', ''],
    ['credential.helper', helper],
    ['credential.useHttpPath', 'true'],
    ['url.https://github.com/.insteadOf', 'git@github.com:'],
    ['url.https://github.com/.insteadOf', 'ssh://git@github.com/'],
  ]
  const name = `${slug}[bot]`
  const email = `${botId}+${slug}[bot]@users.noreply.github.com`
  return {
    PATH: `${join(HERE, 'bin')}:${path}`,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: String(git.length),
    ...Object.fromEntries(git.flatMap(([key, value], i) => [[`GIT_CONFIG_KEY_${i}`, key], [`GIT_CONFIG_VALUE_${i}`, value]])),
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  }
}
