// Installs the factory worker on this machine: writes FACTORY_HOME/config.json and a launchd job that
// runs worker.mjs every few minutes. Run it again to change the settings; it replaces the job.
//
//   node worker/install.mjs --fleet <git url of the fleet repository> --app-id <id> --app-key <path of the .pem>
//   node worker/install.mjs --fleet <url> ... --hubs ~/factories --every 120
//   node worker/install.mjs --uninstall
//
// The GitHub App is the factory's identity: the worker and its sessions use it for each git and gh call,
// over HTTPS, so the machine needs no SSH key and no gh login. See github.mjs.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { api, appInfo } from './github.mjs'

const HOME = process.env.FACTORY_HOME ?? join(homedir(), '.factory')
const LABEL = 'dev.factories-hub.worker'
const PLIST = join(homedir(), 'Library/LaunchAgents', `${LABEL}.plist`)
const WORKER = new URL('worker.mjs', import.meta.url).pathname
const domain = `gui/${process.getuid()}`

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : process.argv[i + 1]
}
const expand = (path) => path.replace(/^~(?=\/|$)/, homedir())

if (process.argv.includes('--uninstall')) {
  spawnSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' })
  rmSync(PLIST, { force: true })
  console.log(`Removed the launchd job. ${HOME} stays, with the clones and the log.`)
  process.exit(0)
}

const fleet = arg('--fleet')
if (!fleet) {
  console.error('Pass --fleet <git url of the fleet repository>')
  process.exit(1)
}
const hubsDir = expand(arg('--hubs', '~/factories'))
const every = Number(arg('--every', '120'))
const paseo = ['paseo', '/Applications/Paseo.app/Contents/Resources/bin/paseo'].find(
  (bin) => spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0
)
if (!paseo) {
  console.error('Paseo is not installed. Install the app, or the CLI with `npm i -g @getpaseo/cli`.')
  process.exit(1)
}

const appId = arg('--app-id')
const key = arg('--app-key') && expand(arg('--app-key'))
if (!appId || !key || !existsSync(key)) {
  console.error('Pass --app-id <id> and --app-key <path of the private key of the GitHub App>')
  process.exit(1)
}
if (statSync(key).mode & 0o077) {
  console.error(`${key} can be read by other users. Run \`chmod 600 ${key}\`, then install again.`)
  process.exit(1)
}
// the real gh, found before the worker puts its own bin/gh first on the PATH
const gh = spawnSync('sh', ['-c', 'command -v gh'], { encoding: 'utf8' }).stdout.trim()
if (!gh) {
  console.error('gh is not installed. Install it with `brew install gh`. It needs no login.')
  process.exit(1)
}
const { slug } = await appInfo({ appId, key })
const { id: botId } = await api(`/users/${encodeURIComponent(`${slug}[bot]`)}`)

mkdirSync(HOME, { recursive: true })
mkdirSync(hubsDir, { recursive: true })
const github = { appId, key, slug, botId, gh }
writeFileSync(join(HOME, 'config.json'), `${JSON.stringify({ fleet, hubsDir, paseo, github }, null, 2)}\n`)

// the job is replaced only after the settings are checked, so a wrong flag leaves the old job running
spawnSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' })

// launchd starts jobs with a bare PATH, so the job gets the PATH of this shell
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
writeFileSync(
  PLIST,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(process.execPath)}</string><string>${xml(WORKER)}</string></array>
  <key>StartInterval</key><integer>${every}</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xml(process.env.PATH)}</string>
    <key>FACTORY_HOME</key><string>${xml(HOME)}</string>
  </dict>
  <key>StandardOutPath</key><string>${xml(join(HOME, 'launchd.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(HOME, 'launchd.log'))}</string>
</dict>
</plist>
`
)

const loaded = spawnSync('launchctl', ['bootstrap', domain, PLIST], { encoding: 'utf8' })
if (loaded.status !== 0) {
  console.error(`launchctl bootstrap failed: ${loaded.stderr}`)
  process.exit(1)
}
console.log(`The worker runs every ${every}s as ${slug}[bot]. Fleet: ${fleet}. Hubs: ${hubsDir}. Log: ${join(HOME, 'worker.log')}`)
console.log(existsSync(join(HOME, 'state.json')) ? 'It keeps its state from before.' : 'Its first poll sets up each hub of the fleet.')
