/**
 * dsh-notion local install script (development convenience).
 *
 * Usage: node scripts/install.mjs [profile]   (default: web, or $DSH_PROFILE)
 *
 * Copies the built plugin into ~/.dsh/profiles/<profile>/node_modules/dsh-notion-connector — the store that profile
 * resolves out-of-tree plugins from. For normal installs use
 * `dsh plugin --profile web add github:anthony1x6000/dsh-notion-connector`.
 *
 * A GUI restart is still required afterwards: the host scans the plugin set
 * at boot ("plugin-set changes take effect on restart").
 */

import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = 'dsh-notion-connector'

const root = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(root, '..')

/** Profile to install into: first argument, then $DSH_PROFILE, then the web GUI profile. */
const profile = process.argv[2]?.trim() || process.env.DSH_PROFILE?.trim() || 'web'

const sourceLib = join(pkgRoot, 'lib/index.js')
if (!existsSync(sourceLib)) {
  throw new Error(`missing ${sourceLib}; run \`pnpm build\` first`)
}

const profileStore = join(homedir(), '.dsh', 'profiles', profile, 'node_modules', PACKAGE_NAME)
mkdirSync(profileStore, { recursive: true })
cpSync(join(pkgRoot, 'lib'), join(profileStore, 'lib'), { recursive: true })
cpSync(join(pkgRoot, 'package.json'), join(profileStore, 'package.json'))
cpSync(join(pkgRoot, 'cordis.patch.yml'), join(profileStore, 'cordis.patch.yml'))

const installed = readFileSync(join(profileStore, 'lib/index.js'), 'utf8')
const built = readFileSync(sourceLib, 'utf8')
if (installed !== built) throw new Error('install mismatch: lib/index.js differs after copy')
console.log(`✔ installed ${PACKAGE_NAME} -> ${profileStore}`)
console.log(`Restart dsh (profile "${profile}") to apply: the host scans its plugin set only at startup.`)
