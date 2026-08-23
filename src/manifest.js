/**
 * The manifest: what this tool delivered to a project, and with which version.
 *
 * It is committed, so on a fresh clone or in CI it is the only available `base` for the
 * three-way comparison `update` will do. See ADR 0001.
 *
 * ## The manifest follows the filesystem, not the plan
 *
 * `mergeManifest` takes what actually happened to each file, not what was planned. The
 * difference is not academic. A project whose manifest records a file at version 1, with
 * that file deleted from disk, gets it written again by `init` — with the content of the
 * version running now. A merge that kept the old entry because "an entry already exists"
 * would leave the manifest claiming a sha that is not on disk, and every later
 * comparison would report drift in a file nobody edited. So the rule is expressed in
 * terms of the outcome: a file that was written or adopted gets the current record, and
 * only a file left untouched keeps the old one.
 *
 * The other direction is the reason the rule cannot simply be "always record the plan":
 * an entry that already exists for a file that is still on disk must not move. Its sha
 * and its `seededBy` are what makes a local modification detectable, and rewriting them
 * to the current version would make that modification read as up to date and lose it at
 * the next update without a conflict ever being raised.
 *
 * ## What a result may contain
 *
 * A `SeedResult` carries the sha *of the planned seed*. There is deliberately no field
 * for the content found on disk. Adoption — recording an entry for a file a user wrote
 * by hand — is the case where the distinction decides whether that file survives, and a
 * type with nowhere to put the user's bytes is a stronger guarantee than a comment
 * asking the caller not to pass them.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { SEED_CLASSES, projectPathProblem } from './seeds/catalog.js'

/** @typedef {import('./seeds/catalog.js').SeedClass} SeedClass */

/** Name of the manifest in the target project. */
export const MANIFEST_FILENAME = '.afk-manifest.json'

/**
 * Notice carried as the first key of the file.
 *
 * The manifest is a generated state file that lives in somebody's repository, which
 * means people will meet it as a Git merge conflict and resolve it by hand. A resolution
 * that mixes two shas is not visibly wrong — it is well-formed JSON describing content
 * that was never delivered. Nothing here can detect that, so the warning is the only
 * thing between a hand-merge and a silently wrong `base`.
 */
export const MANIFEST_WARNING = 'This file is machine-generated. Do not edit.'

/** What happened to a file during a run. */
const OUTCOMES = ['written', 'adopted', 'skipped']

const ENTRY_FIELDS = ['class', 'sha', 'seededBy']

const SHA_PATTERN = /^sha256:[0-9a-f]{64}$/

/**
 * One file as the engine delivered it.
 *
 * @typedef {object} ManifestEntry
 * @property {SeedClass} class Who owns the file.
 * @property {string} sha Digest of the content delivered, never of content on disk.
 * @property {string} seededBy Version of this package that delivered it.
 */

/**
 * @typedef {object} Manifest
 * @property {string} engineVersion Version that last maintained this manifest.
 * @property {number} configVersion Schema version of the configuration file.
 * @property {Record<string, ManifestEntry>} seeds Entries by project-relative path.
 */

/**
 * What became of one planned seed during a run.
 *
 * @typedef {object} SeedResult
 * @property {string} target Project-relative path.
 * @property {SeedClass} class Who owns the file.
 * @property {string} sha Digest of the planned seed content.
 * @property {'written' | 'adopted' | 'skipped'} outcome What the run did with the file:
 *   `written` if this run put the content there, `adopted` if the file was already there
 *   and had no entry, `skipped` if it was already there and already recorded.
 */

/**
 * @param {string} message
 * @returns {never}
 */
function invalid(message) {
  throw new Error(`manifest is invalid: ${message}`)
}

/**
 * Validates one recorded entry.
 *
 * @param {unknown} raw
 * @param {string} target Path the entry is filed under, for the error message.
 * @returns {ManifestEntry}
 */
function parseEntry(raw, target) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) invalid(`seeds["${target}"] must be an object`)
  const value = /** @type {Record<string, unknown>} */ (raw)

  for (const key of Object.keys(value)) {
    if (!ENTRY_FIELDS.includes(key)) invalid(`seeds["${target}"] has an unknown field "${key}"`)
  }

  const seedClass = value.class
  if (typeof seedClass !== 'string' || !SEED_CLASSES.some((c) => c === seedClass)) {
    invalid(`seeds["${target}"].class must be one of: ${SEED_CLASSES.join(' | ')}`)
  }
  // Checked against the shape this tool writes rather than merely for being a string: a
  // truncated or re-wrapped sha from a hand-resolved conflict is the realistic corruption,
  // and it would otherwise be discovered as an unexplainable drift report much later.
  if (typeof value.sha !== 'string' || !SHA_PATTERN.test(value.sha)) {
    invalid(`seeds["${target}"].sha must look like sha256:<64 hex digits>`)
  }
  if (typeof value.seededBy !== 'string' || value.seededBy === '') {
    invalid(`seeds["${target}"].seededBy must be a non-empty string`)
  }

  return { class: /** @type {SeedClass} */ (seedClass), sha: value.sha, seededBy: value.seededBy }
}

/**
 * Validates a parsed manifest document.
 *
 * Entries for files this package no longer ships are kept. An orphan is the only record
 * that the file was ever delivered, and `update` needs it to report the seed as
 * deprecated — dropping it here would leave the file in a repository with nothing
 * anywhere saying where it came from.
 *
 * The `_warning` key is accepted and dropped: it is written for humans and carries no
 * state, so round-tripping it would make it look like something the tool reads.
 *
 * Kept separate from reading the file so the rules can be exercised without a fixture on
 * disk, mirroring `parseCatalog`.
 *
 * @param {unknown} doc Parsed manifest document.
 * @returns {Manifest}
 * @throws {Error} If the document is not a manifest this tool could have written.
 */
export function parseManifest(doc) {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) invalid('expected an object')
  const value = /** @type {Record<string, unknown>} */ (doc)

  if (typeof value.engineVersion !== 'string' || value.engineVersion === '') {
    invalid('engineVersion must be a non-empty string')
  }
  if (typeof value.configVersion !== 'number' || !Number.isInteger(value.configVersion)) {
    invalid('configVersion must be an integer')
  }
  const seeds = value.seeds
  if (typeof seeds !== 'object' || seeds === null || Array.isArray(seeds)) invalid('seeds must be an object')

  /** @type {Record<string, ManifestEntry>} */
  const entries = {}
  for (const [target, raw] of Object.entries(seeds)) {
    const problem = projectPathProblem(target)
    if (problem !== null) invalid(`seed path "${target}" ${problem}`)
    entries[target] = parseEntry(raw, target)
  }

  return { engineVersion: value.engineVersion, configVersion: value.configVersion, seeds: entries }
}

/**
 * Applies the outcome of a run to the manifest.
 *
 * Pure: the caller reports what happened, this decides what is recorded. Which is what
 * keeps the two rules that pull against each other in one readable place — record what
 * was just delivered, and never move a record for a file that was left alone.
 *
 * Entries no result mentions are carried over untouched, whether they belong to a seed
 * that was skipped in a way the caller did not report or to one this package no longer
 * ships.
 *
 * @param {object} options
 * @param {Manifest | null} options.existing Manifest already in the project, if any.
 * @param {readonly SeedResult[]} options.results What became of each planned seed.
 * @param {string} options.engineVersion Version running now.
 * @param {number} options.configVersion Schema version of the configuration file.
 * @returns {Manifest} A new manifest; the input is not modified.
 * @throws {Error} If a result reports an outcome that cannot be recorded.
 */
export function mergeManifest({ existing, results, engineVersion, configVersion }) {
  /** @type {Record<string, ManifestEntry>} */
  const seeds = { ...(existing?.seeds ?? {}) }

  for (const result of results) {
    if (!OUTCOMES.includes(result.outcome)) {
      throw new Error(`cannot record an unknown outcome "${result.outcome}" for ${result.target}`)
    }
    if (result.outcome === 'skipped') {
      // A file that exists without an entry is an adoption, not a skip. Recording
      // nothing here would drop it from the manifest — the one outcome that loses a
      // file silently — so a caller that classified it wrongly is told, loudly.
      if (seeds[result.target] === undefined) {
        throw new Error(`cannot skip ${result.target}: no entry to keep`)
      }
      continue
    }
    seeds[result.target] = { class: result.class, sha: result.sha, seededBy: engineVersion }
  }

  // Top level rather than per entry, and therefore safe to move: it says which engine
  // last maintained the file and makes no claim about any particular seed.
  return { engineVersion, configVersion, seeds }
}

/**
 * Serialises a manifest to the exact bytes that belong in the file.
 *
 * Deterministic by construction: the warning first, then the two versions, then the
 * entries sorted by path in byte order with their fields in a fixed order. A committed
 * file that reorders itself between runs is unreadable in review, and every run of
 * `init` writes this one.
 *
 * @param {Manifest} manifest
 * @returns {string} JSON with two-space indentation and a trailing newline.
 */
export function serialiseManifest(manifest) {
  /** @type {Record<string, ManifestEntry>} */
  const seeds = {}
  for (const target of Object.keys(manifest.seeds).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const entry = /** @type {ManifestEntry} */ (manifest.seeds[target])
    seeds[target] = { class: entry.class, sha: entry.sha, seededBy: entry.seededBy }
  }

  const document = {
    _warning: MANIFEST_WARNING,
    engineVersion: manifest.engineVersion,
    configVersion: manifest.configVersion,
    seeds,
  }
  return `${JSON.stringify(document, null, 2)}\n`
}

/**
 * Reads the manifest of a project.
 *
 * A project without one is the normal case on a first `init`, so it is reported as
 * absent rather than as a failure. Anything else is a failure: rewriting a manifest we
 * could not read would backdate every `seededBy` it held to the version running now.
 *
 * @param {string} projectRoot Root of the target project.
 * @returns {Manifest | null} The manifest, or `null` if the project has none.
 * @throws {Error} If the file exists but cannot be read as a manifest.
 */
export function readManifest(projectRoot) {
  const file = path.join(projectRoot, MANIFEST_FILENAME)
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return null
  }

  let doc
  try {
    doc = JSON.parse(raw)
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${String(err)}`)
  }
  return parseManifest(doc)
}

/**
 * Writes the manifest of a project.
 *
 * @param {string} projectRoot Root of the target project.
 * @param {Manifest} manifest
 * @returns {void}
 */
export function writeManifest(projectRoot, manifest) {
  writeFileSync(path.join(projectRoot, MANIFEST_FILENAME), serialiseManifest(manifest), 'utf8')
}
