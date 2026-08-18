/**
 * The seed catalog: which files this package ships, where they land in a target
 * project, and who owns them afterwards.
 *
 * Ownership is *declared* here rather than inferred from a path or an extension at
 * runtime. An inferred class is a rule that lives in two places — the code that guesses
 * and the reader's head — and the two disagree the first time a seed is added that does
 * not fit the pattern. A wrong guess is expensive in a specific way: it decides whether
 * `update` overwrites a file or leaves it alone. See ADR 0001.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { SEEDS_DIR, listFiles } from '../pkg.js'

/**
 * Who owns a seeded file once it is in the target project.
 *
 * `managed` is overwritten on update; `seed-once` belongs to the user from the moment it
 * is first written. There is deliberately no shared third class.
 *
 * @typedef {'managed' | 'seed-once'} SeedClass
 */

/**
 * Comment syntax used for the marker line, or `none` for formats that have no comments.
 *
 * @typedef {'hash' | 'html' | 'none'} MarkerType
 */

/**
 * @typedef {object} CatalogEntry
 * @property {string} source Template path, relative to `seeds/templates/`.
 * @property {string} target Where the rendered file goes, relative to the project root.
 * @property {SeedClass} class Who owns the file after it has been written.
 * @property {MarkerType} marker Comment syntax for the marker line.
 */

/** @type {readonly SeedClass[]} */
export const SEED_CLASSES = ['managed', 'seed-once']

/** @type {readonly MarkerType[]} */
export const MARKER_TYPES = ['hash', 'html', 'none']

/** Name of the catalog document inside the seeds directory. */
export const CATALOG_FILENAME = 'catalog.json'

/**
 * Subdirectory holding the templates.
 *
 * Templates live one level below the catalog so that "every file here is a seed" stays
 * literally true, and so a template never looks like the file it renders to.
 */
export const TEMPLATES_DIRNAME = 'templates'

const FIELDS = ['source', 'target', 'class', 'marker']

const BACKSLASH = String.fromCharCode(92)

/**
 * Rewrites a filesystem path to POSIX separators.
 *
 * Applied where paths derived from the filesystem enter the module, never to paths a
 * human wrote into the catalog: there, a backslash is an authoring mistake and is
 * rejected rather than repaired, because silently accepting `.github\x.yml` hides that
 * somebody typed a Windows path and may have meant a different file.
 *
 * @param {string} value
 * @returns {string}
 */
function toPosix(value) {
  return value.split(BACKSLASH).join('/')
}

/**
 * @param {string} message
 * @returns {never}
 */
function invalid(message) {
  throw new Error(`seed catalog is invalid: ${message}`)
}

/**
 * Rejects anything that is not a plain, normalised, project-relative path.
 *
 * Targets are joined onto the root of somebody else's repository and then written to, so
 * a path that escapes it does not fail — it quietly writes outside the project. Sources
 * and targets are also used as map keys in the manifest, which is committed: a backslash
 * would give a Windows machine different keys than a Linux one for the same file.
 *
 * @param {unknown} value
 * @param {string} field
 * @param {number} index
 * @returns {string}
 */
function relativePath(value, field, index) {
  if (typeof value !== 'string' || value === '') invalid(`seeds[${index}].${field} must be a non-empty string`)
  if (value.includes(BACKSLASH)) invalid(`seeds[${index}].${field} must use "/" as the separator: ${value}`)
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) invalid(`seeds[${index}].${field} must be relative: ${value}`)
  const segments = value.split('/')
  if (segments.includes('.') || segments.includes('..') || segments.includes('')) {
    invalid(`seeds[${index}].${field} must be a normalised path: ${value}`)
  }
  return value
}

/**
 * Validates a parsed catalog document.
 *
 * Kept separate from reading the file so the rules can be exercised without a fixture on
 * disk, and so `loadCatalog` is only about the filesystem.
 *
 * @param {unknown} doc Parsed catalog document.
 * @returns {CatalogEntry[]} Entries, sorted by target.
 */
export function parseCatalog(doc) {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) invalid('expected an object')
  const seeds = /** @type {Record<string, unknown>} */ (doc).seeds
  if (seeds === undefined) invalid('missing "seeds"')
  if (!Array.isArray(seeds)) invalid('"seeds" must be an array')

  /** @type {CatalogEntry[]} */
  const entries = []
  seeds.forEach((raw, index) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) invalid(`seeds[${index}] must be an object`)
    const seed = /** @type {Record<string, unknown>} */ (raw)

    for (const key of Object.keys(seed)) {
      if (!FIELDS.includes(key)) invalid(`seeds[${index}] has an unknown field "${key}"`)
    }

    const seedClass = seed.class
    if (typeof seedClass !== 'string' || !SEED_CLASSES.some((c) => c === seedClass)) {
      invalid(`seeds[${index}].class must be one of: ${SEED_CLASSES.join(' | ')}`)
    }
    const marker = seed.marker
    if (typeof marker !== 'string' || !MARKER_TYPES.some((m) => m === marker)) {
      invalid(`seeds[${index}].marker must be one of: ${MARKER_TYPES.join(' | ')}`)
    }
    // The marker follows from the class, in both directions.
    //
    // A managed file is replaced without being asked, so it has to say so in its own
    // content — that is the only place a human looking at the diff will find out why.
    //
    // A seed-once file is never touched again, so a marker on it would be a claim the
    // engine cannot keep: it carries a version that stops being true the moment the
    // package moves on, and it would invite marker-aware code paths for files no code
    // path will ever revisit.
    if (seedClass === 'managed' && marker === 'none') {
      invalid(`seeds[${index}] is managed and must declare a marker type`)
    }
    if (seedClass === 'seed-once' && marker !== 'none') {
      invalid(`seeds[${index}] is seed-once and must declare marker "none", not "${marker}"`)
    }

    entries.push({
      source: relativePath(seed.source, 'source', index),
      target: relativePath(seed.target, 'target', index),
      class: /** @type {SeedClass} */ (seedClass),
      marker: /** @type {MarkerType} */ (marker),
    })
  })

  for (const field of /** @type {const} */ (['source', 'target'])) {
    const seen = new Set()
    for (const entry of entries) {
      if (seen.has(entry[field])) invalid(`duplicate ${field}: ${entry[field]}`)
      seen.add(entry[field])
    }
  }

  // Byte order rather than a locale-aware comparison: this ordering ends up in a
  // committed manifest, where a diff that depends on the machine's locale is noise.
  return entries.sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0))
}

/**
 * Reads and validates the catalog shipped with the package.
 *
 * Checks both directions between catalog and directory: an entry without a file would
 * fail at write time, and a file without an entry would ship unnoticed and never be
 * seeded — a silent omission is the worse of the two, because nothing ever reports it.
 *
 * @param {string} [seedsDir] Directory holding the catalog. Defaults to the packaged one.
 * @returns {CatalogEntry[]} Entries, sorted by target.
 */
export function loadCatalog(seedsDir = SEEDS_DIR) {
  const catalogPath = path.join(seedsDir, CATALOG_FILENAME)
  let raw
  try {
    raw = readFileSync(catalogPath, 'utf8')
  } catch {
    throw new Error(`seed catalog not found at ${catalogPath}`)
  }

  let doc
  try {
    doc = JSON.parse(raw)
  } catch (err) {
    throw new Error(`seed catalog at ${catalogPath} is not valid JSON: ${String(err)}`)
  }

  const entries = parseCatalog(doc)
  const templatesDir = path.join(seedsDir, TEMPLATES_DIRNAME)
  let files
  try {
    // Normalised again rather than trusted. listFiles already returns POSIX paths, but
    // these are about to be compared against catalog keys that end up in a committed
    // manifest: if that ever changed, the mismatch would surface as a bogus "no catalog
    // entry" on Windows only, and the invariant is cheaper to enforce than to debug.
    files = listFiles(templatesDir).map(toPosix)
  } catch {
    throw new Error(`seed templates directory not found at ${templatesDir}`)
  }

  const declared = new Set(entries.map((e) => e.source))
  for (const entry of entries) {
    if (!files.includes(entry.source)) invalid(`no template file for ${entry.source}`)
  }
  for (const file of files) {
    if (!declared.has(file)) invalid(`template file ${file} has no catalog entry`)
  }
  return entries
}
