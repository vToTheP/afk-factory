/**
 * Values read out of the project so that `init` has fewer questions to ask.
 *
 * Everything here is a convenience and behaves like one: a value that cannot be
 * determined is reported as absent, never guessed. The guess would be written into a
 * committed workflow in somebody else's repository, and the first sign of a wrong one is
 * a red run in a project that has just been set up — the moment a person is least able
 * to tell a broken tool from a broken setup.
 *
 * Absence is not a failure either. `init` collects the missing keys and names them all
 * at once, and the interactive setup that replaces `--set` will ask for exactly these.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { currentBranch, remoteDefaultBranch } from './git.js'
import { packageVersion } from './pkg.js'

/**
 * Template values that can be worked out without asking.
 *
 * @typedef {object} DetectedValues
 * @property {string} engineVersion Version of this package.
 * @property {string} [defaultBranch] Main line of development.
 * @property {string} [nodeVersion] Node version the project pins.
 * @property {string} [lintCommand] Command for the lint gate.
 * @property {string} [testCommand] Command for the test gate.
 * @property {string} [buildCommand] Command for the build gate.
 */

/**
 * Reads a project's `package.json`, if it has a readable one.
 *
 * @param {string} root
 * @returns {Record<string, unknown> | null}
 */
function packageManifest(root) {
  try {
    const doc = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    return typeof doc === 'object' && doc !== null && !Array.isArray(doc) ? doc : null
  } catch {
    // A missing or broken package.json is the project's business. Detection is optional
    // by construction, so there is nothing here worth interrupting a run for.
    return null
  }
}

/**
 * @param {Record<string, unknown> | null} doc
 * @param {string} name
 * @returns {string | undefined}
 */
function script(doc, name) {
  const scripts = doc?.scripts
  if (typeof scripts !== 'object' || scripts === null) return undefined
  const value = /** @type {Record<string, unknown>} */ (scripts)[name]
  if (typeof value !== 'string' || value === '') return undefined
  // The script name, not its body: the gate should keep meaning what the project means
  // by it after somebody edits the script.
  return name === 'test' ? 'npm test' : `npm run ${name}`
}

/**
 * The Node version the project pins, if it pins one.
 *
 * `.nvmrc` wins over `engines.node`, because a range is not a version. Turning `>=18`
 * into something `setup-node` accepts means choosing a member of the range, and the
 * choice belongs to whoever maintains the project — this only falls back to the first
 * number in the range when there is nothing better, and the value stays visible in the
 * configuration file afterwards.
 *
 * @param {string} root
 * @param {Record<string, unknown> | null} doc
 * @returns {string | undefined}
 */
function nodeVersion(root, doc) {
  try {
    const pinned = readFileSync(path.join(root, '.nvmrc'), 'utf8').trim()
    if (pinned !== '') return pinned.replace(/^v/, '')
  } catch {
    // No .nvmrc; fall through to engines.
  }

  const engines = doc?.engines
  const range = typeof engines === 'object' && engines !== null ? /** @type {Record<string, unknown>} */ (engines).node : undefined
  if (typeof range !== 'string') return undefined
  const match = range.match(/\d+(?:\.\d+)*/)
  return match?.[0]
}

/**
 * Works out everything about a project that does not need to be asked.
 *
 * @param {string} root Repository root of the target project.
 * @returns {DetectedValues} Only the keys that could be determined.
 */
export function detectValues(root) {
  const doc = packageManifest(root)

  /** @type {DetectedValues} */
  const values = { engineVersion: packageVersion() }

  const branch = remoteDefaultBranch(root) ?? currentBranch(root)
  if (branch !== undefined) values.defaultBranch = branch

  const node = nodeVersion(root, doc)
  if (node !== undefined) values.nodeVersion = node

  for (const [key, name] of /** @type {const} */ ([
    ['lintCommand', 'lint'],
    ['testCommand', 'test'],
    ['buildCommand', 'build'],
  ])) {
    const command = script(doc, name)
    if (command !== undefined) values[key] = command
  }

  return values
}
