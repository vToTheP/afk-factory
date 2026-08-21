/**
 * The seed plan: the files this package would deliver to a project, and nothing about
 * what is already in it.
 *
 * `init` writes this output; the drift comparison that comes later compares against it.
 * That is the whole reason the planning is a module of its own rather than a loop inside
 * `init`: the two commands must agree on what "delivered" means down to the byte, and
 * two implementations of the same three steps would not stay in agreement for long.
 *
 * ## Render, then hash, then stamp
 *
 * The order is fixed and not interchangeable.
 *
 * Hashing happens after rendering because a template is not what lands in the project —
 * hashing it would make every parameterised file read as modified from the moment it was
 * written. It happens before stamping because the marker contains the hash, so there is
 * nothing to stamp until it exists.
 *
 * `contentSha` strips the marker before hashing, so hashing the stamped content would
 * currently produce the same digest. That is a property of today's marker, not a reason
 * to rely on the order being unimportant: the two agree only as long as everything a
 * marker line contributes is removed again, and the first change to that would show up
 * as manifests that no longer match files nobody edited.
 *
 * ## What this module may touch
 *
 * It reads the templates it ships with, and nothing else. Not the target project, not
 * the working directory. A planner that peeked at the project would put the comparison
 * between wanted and actual state in two places, and the copy inside the planner is the
 * one no test would think to write.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PKG_ROOT, seedsDirFor } from '../pkg.js'
import { TEMPLATES_DIRNAME, loadCatalog } from './catalog.js'
import { applyMarker, contentSha } from './marker.js'
import { placeholders, render } from './render.js'

/** @typedef {import('./catalog.js').SeedClass} SeedClass */

/**
 * One file as this package would deliver it.
 *
 * @typedef {object} PlannedSeed
 * @property {string} target Project-relative POSIX path the file belongs at.
 * @property {SeedClass} class Who owns the file once it has been written.
 * @property {string} rendered Exact content to write, marker included.
 * @property {string} sha Digest of the rendered content, recorded in the manifest.
 */

/**
 * Reads one template.
 *
 * @param {string} pkgRoot
 * @param {string} source Template path, relative to the templates directory.
 * @returns {string}
 */
function readTemplate(pkgRoot, source) {
  return readFileSync(path.join(seedsDirFor(pkgRoot), TEMPLATES_DIRNAME, source), 'utf8')
}

/**
 * Lists every value the packaged seeds need, across all of them.
 *
 * Exists so a caller can find out what is missing before it starts writing, and report
 * all of it at once. One missing key per failed run is a conversation rather than an
 * error message, and every run that gets part of the way leaves a project half seeded.
 *
 * It is also the question the interactive setup has to answer — these keys are exactly
 * what it will ask about — which is why it is derived from the templates rather than
 * written down a second time.
 *
 * @param {object} [options]
 * @param {string} [options.pkgRoot] Package root to read seeds from.
 * @returns {string[]} Keys, deduplicated, in catalog order.
 */
export function requiredValues({ pkgRoot = PKG_ROOT } = {}) {
  /** @type {string[]} */
  const keys = []
  for (const entry of loadCatalog(seedsDirFor(pkgRoot))) {
    for (const key of placeholders(readTemplate(pkgRoot, entry.source))) {
      if (!keys.includes(key)) keys.push(key)
    }
  }
  return keys
}

/**
 * Plans every seed this package ships.
 *
 * Pure with respect to the target project: it reads the packaged templates and returns
 * content. Writing, and deciding whether to write at all, belongs to the caller.
 *
 * Failures propagate. A missing template value or a catalog that does not validate ends
 * the run before anything is written, which is the point of planning as a separate step
 * — the alternative is a project left half seeded, with a manifest describing files that
 * were never delivered.
 *
 * @param {object} options
 * @param {Record<string, unknown>} options.config Template values by placeholder key.
 *   Mapping a richer configuration document onto these keys is the caller's job: the
 *   renderer's contract is one flat key per placeholder, and a translation layer here
 *   would be a second place to look when a value comes out wrong.
 * @param {string} [options.pkgRoot] Package root to read seeds from. Defaults to the
 *   installed package; overridden in tests.
 * @returns {PlannedSeed[]} One entry per seed, sorted by target.
 * @throws {Error} If the catalog is invalid, a template is missing, or a value is not
 *   supplied.
 */
export function buildSeedPlan({ config, pkgRoot = PKG_ROOT }) {
  return loadCatalog(seedsDirFor(pkgRoot)).map((entry) => {
    const content = render(readTemplate(pkgRoot, entry.source), config)
    const sha = contentSha(content)
    return {
      target: entry.target,
      class: entry.class,
      rendered: applyMarker(entry.marker, content, sha),
      sha,
    }
  })
}
