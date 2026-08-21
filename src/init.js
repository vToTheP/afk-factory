/**
 * `init`: put the factory's files into a project and record what was delivered.
 *
 * Orchestration only. Every decision it makes has been made somewhere else — the catalog
 * says what ships and who owns it, the planner says what the files should contain, the
 * manifest says what is recorded. What is left here is the order, and one rule that
 * belongs nowhere else because it is about the filesystem: **init never overwrites.**
 *
 * An existing file is left exactly as it is, whatever its class. Replacing a `managed`
 * file is `update`'s job, and `update` is where the conflict contract lives — a file
 * that is quietly replaced by a setup command has no plan output, no `.afk-new`
 * alongside, and no diff anybody was shown. If such a file has no manifest entry it is
 * adopted: an entry is written, the file is not touched.
 *
 * The order of the last two steps is deliberate. Files are written first, the manifest
 * last, so that a run interrupted half way leaves files without a record rather than a
 * record claiming files that are not there. The first is repaired by running `init`
 * again; the second would have to be repaired by hand, because a manifest is a claim
 * about content and nothing checks it.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { CONFIG_VERSION } from './config.js'
import { detectValues } from './detect.js'
import { UserError } from './errors.js'
import { repoRoot } from './git.js'
import { MANIFEST_FILENAME, mergeManifest, readManifest, writeManifest } from './manifest.js'
import { packageVersion } from './pkg.js'
import { buildSeedPlan, requiredValues } from './seeds/plan.js'

/** @typedef {import('./manifest.js').Manifest} Manifest */
/** @typedef {import('./manifest.js').SeedResult} SeedResult */
/** @typedef {import('./seeds/plan.js').PlannedSeed} PlannedSeed */

const USAGE = `afk-factory init [--set <key>=<value>]

  --set   supply one template value; repeatable

Values that are not supplied are read from the repository. Nothing is invented: if a
value is neither given nor found, the run stops and names it.

--set is scaffolding, and unstable. It exists so the command can be used and tested
before the interactive setup that will replace it.`

/**
 * Reads the command line.
 *
 * @param {string[]} argv
 * @returns {{ values: Record<string, string>, help: boolean }}
 * @throws {UserError} On anything it does not understand.
 */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const values = {}

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') return { values, help: true }
    if (arg !== '--set') throw new UserError(`Unknown argument "${arg}".\n\n${USAGE}`)

    const pair = argv[i + 1]
    i += 1
    if (pair === undefined || !pair.includes('=')) {
      throw new UserError(`--set expects <key>=<value>, got ${pair === undefined ? 'nothing' : `"${pair}"`}.`)
    }
    // Split at the first `=` only: a gate command is a legitimate value and may contain
    // more of them.
    const at = pair.indexOf('=')
    values[pair.slice(0, at)] = pair.slice(at + 1)
  }

  return { values, help: false }
}

/**
 * Reads the project's manifest, reporting a broken one as something to fix.
 *
 * @param {string} root
 * @returns {Manifest | null}
 * @throws {UserError} If a manifest exists but cannot be read.
 */
function existingManifest(root) {
  try {
    return readManifest(root)
  } catch (err) {
    // Not a defect in this tool: the file is committed, so it reaches us with whatever a
    // merge conflict resolution left in it. Carrying on would mean replacing it, which
    // backdates every seededBy it holds to the version running now.
    throw new UserError(
      `${err instanceof Error ? err.message : String(err)}\n` +
        `Fix ${MANIFEST_FILENAME} or delete it — a deleted manifest is rebuilt by adoption.`,
    )
  }
}

/**
 * Writes one planned seed, unless the file is already there.
 *
 * The existence check is the write itself, with the exclusive flag: asking first and
 * writing afterwards is two answers to one question, and the file can appear between
 * them. Here the filesystem decides once, and "never overwrites" is a property of the
 * call rather than of the branch above it.
 *
 * @param {string} root Repository root.
 * @param {PlannedSeed} seed
 * @param {Manifest | null} manifest Manifest as it was before this run.
 * @returns {SeedResult}
 */
function deliver(root, seed, manifest) {
  const file = path.join(root, seed.target)
  const outcome = (/** @type {SeedResult['outcome']} */ value) => ({
    target: seed.target,
    class: seed.class,
    sha: seed.sha,
    outcome: value,
  })

  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, seed.rendered, { encoding: 'utf8', flag: 'wx' })
    return outcome('written')
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'EEXIST') throw err
    // Already there. Recorded already means this run has nothing to say about it;
    // unrecorded means we adopt it, entry only.
    return outcome(manifest?.seeds[seed.target] === undefined ? 'adopted' : 'skipped')
  }
}

/** @type {Record<SeedResult['outcome'], string>} */
const REPORT = {
  written: 'Wrote:  ',
  adopted: 'Adopted:',
  skipped: 'Skipped:',
}

/**
 * Seeds a project.
 *
 * @param {Record<string, string>} given Values from the command line.
 * @param {string} cwd Directory the command was invoked in.
 * @returns {number} Exit code.
 */
function seedProject(given, cwd) {
  const root = repoRoot(cwd)

  // Given beats detected. Detection is a convenience and the operator is the one who
  // knows; a flag that loses to a guess is worse than no flag.
  /** @type {Record<string, string | undefined>} */
  const config = { ...detectValues(root), ...given }

  const missing = requiredValues().filter((key) => config[key] === undefined)
  if (missing.length > 0) {
    throw new UserError(
      `Missing ${missing.length === 1 ? 'a value' : 'values'} for: ${missing.join(', ')}\n` +
        `Supply ${missing.length === 1 ? 'it' : 'them'} with ${missing.map((k) => `--set ${k}=<value>`).join(' ')}`,
    )
  }

  // Planned before anything is opened for writing, so a template that cannot be rendered
  // stops the run while the project is still untouched.
  const plan = buildSeedPlan({ config })
  const manifest = existingManifest(root)

  const results = plan.map((seed) => deliver(root, seed, manifest))
  writeManifest(
    root,
    mergeManifest({
      existing: manifest,
      results,
      engineVersion: packageVersion(),
      configVersion: CONFIG_VERSION,
    }),
  )

  for (const result of results) console.log(`${REPORT[result.outcome]} ${result.target}`)
  console.log(`Recorded in ${MANIFEST_FILENAME}.`)
  return 0
}

/**
 * Command entry point.
 *
 * @param {string[]} argv Arguments after the verb.
 * @param {string} [cwd] Directory to treat as the invocation point. The CLI never passes
 *   this; it is the seam that lets the command be tested without moving the process.
 * @returns {number} Exit code: 0 on success, 1 on anything the operator has to fix.
 */
export default function init(argv, cwd = process.cwd()) {
  try {
    const { values, help } = parseArgs(argv)
    if (help) {
      console.log(USAGE)
      return 0
    }
    return seedProject(values, cwd)
  } catch (err) {
    // A UserError is an instruction, and a stack above it buries the one line that says
    // what to do. Anything else is a defect and keeps its stack, which the dispatcher
    // prints.
    if (!(err instanceof UserError)) throw err
    console.error(err.message)
    return 1
  }
}
