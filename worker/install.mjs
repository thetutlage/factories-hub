// Installs the factory worker on this machine: writes FACTORY_HOME/config.json and a launchd job that
// runs worker.mjs every few minutes. Run it again to change the settings; it replaces the job.
//
//   node worker/install.mjs --fleet <git url of the fleet repository>
//   node worker/install.mjs --fleet <url> --hubs ~/factories --every 120
//   node worker/install.mjs --uninstall
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

spawnSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' })

if (process.argv.includes('--uninstall')) {
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

mkdirSync(HOME, { recursive: true })
mkdirSync(hubsDir, { recursive: true })
writeFileSync(join(HOME, 'config.json'), `${JSON.stringify({ fleet, hubsDir, paseo }, null, 2)}\n`)

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
console.log(`The worker runs every ${every}s. Fleet: ${fleet}. Hubs: ${hubsDir}. Log: ${join(HOME, 'worker.log')}`)
console.log(existsSync(join(HOME, 'state.json')) ? 'It keeps its state from before.' : 'Its first poll sets up each hub of the fleet.')
