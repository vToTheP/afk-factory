/**
 * The marker line, and the hash it is kept out of.
 *
 * A seeded file carries a one-line comment saying what it is. The manifest, not this
 * line, is the source of truth — nothing branches on a marker being present, and JSON
 * targets cannot carry one at all. It exists so that somebody who opens the file in a
 * repository they did not set up can tell why it is there.
 *
 * ## Why marking and hashing live in the same module
 *
 * The hash recorded in the manifest is taken over content with the marker removed and
 * line endings normalised. Both exclusions exist for the same reason: they change
 * without the file's meaning changing, so counting them turns drift detection into
 * noise. The marker is restamped on every release, and a Git checkout on Windows
 * rewrites every line ending on the way to disk.
 *
 * That makes stripping and hashing one operation rather than two that callers are
 * expected to compose in the right order. A caller who hashes first and strips second
 * gets a plausible digest that is wrong, and nothing about the result says so. Keeping
 * `contentSha` here — rather than in the manifest module, where the hash is stored —
 * means the mistake is not available to make.
 */
import { createHash } from 'node:crypto'

/** @typedef {import('./catalog.js').MarkerType} MarkerType */

/** Machine-readable tag identifying a marker line. */
export const MARKER_TAG = 'afk-factory-state'

/**
 * Matches a marker in either comment form, with its trailing line break.
 *
 * Anchored on the tag rather than on the comment character, so an ordinary comment that
 * happens to mention the tool is not mistaken for a marker and deleted.
 */
const MARKER_LINE = new RegExp(`^[ \\t]*(?:#|<!--)[ \\t]*${MARKER_TAG}:.*(?:\\r?\\n|$)`, 'gm')

const CR = String.fromCharCode(13)

/**
 * Matches the first line ending in a piece of content.
 */
const FIRST_LINE_ENDING = /\r?\n/

/**
 * The line ending a piece of content already uses, LF if it uses none.
 *
 * @param {string} content
 * @returns {string}
 */
function lineEndingOf(content) {
  const match = content.match(FIRST_LINE_ENDING)
  return match === null ? '\n' : match[0]
}

/**
 * Rewrites CRLF line endings to LF.
 *
 * @param {string} content
 * @returns {string}
 */
function toLf(content) {
  return content.split(CR + '\n').join('\n')
}

/**
 * Builds the marker line for a target format.
 *
 * @param {MarkerType} type Comment syntax to use.
 * @param {string} sha The digest to record, already prefixed, e.g. `sha256:…`.
 * @returns {string | null} The line without a trailing break, or `null` when the format
 *   has no comment syntax and therefore carries no marker.
 */
export function markerLine(type, sha) {
  if (type === 'hash') return `# ${MARKER_TAG}: ${sha}`
  if (type === 'html') return `<!-- ${MARKER_TAG}: ${sha} -->`
  return null
}

/**
 * Removes the marker from content, if there is one.
 *
 * Tolerant on purpose: content with no marker, content with CRLF endings and empty
 * content all come back without special handling by the caller. Most content this sees
 * has no marker — every JSON seed, and every file a user wrote by hand — so the absent
 * case is the normal one rather than an error.
 *
 * @param {string} content
 * @returns {string} The content with any marker line removed.
 */
export function stripMarker(content) {
  return content.replace(MARKER_LINE, '')
}

/**
 * Stamps content with a marker, replacing one that is already there.
 *
 * Replacing rather than prepending keeps the operation idempotent: `init` writes a file
 * and `update` rewrites it, and a marker per release would otherwise accumulate.
 *
 * The marker is terminated with the line ending the content already uses. Prepending a
 * line with a hardcoded LF to a CRLF file produces mixed endings, which Git warns about
 * and an editor silently normalises on the next save — and that save then reads as drift
 * in a file its author never meant to change. The ending is taken from the content with
 * the old marker already removed, so a file stamped by a version that got this wrong is
 * repaired the next time it is written rather than kept mixed.
 *
 * @param {MarkerType} type Comment syntax to use.
 * @param {string} content Content to stamp, with or without an existing marker.
 * @param {string} sha The digest to record, already prefixed.
 * @returns {string} The stamped content, unchanged if the format carries no marker.
 */
export function applyMarker(type, content, sha) {
  const line = markerLine(type, sha)
  if (line === null) return content
  const body = stripMarker(content)
  return `${line}${lineEndingOf(body)}${body}`
}

/**
 * The digest recorded in the manifest for a piece of content.
 *
 * Normalises line endings and removes the marker before hashing, so the result depends
 * on what the file means rather than on which machine checked it out or which release
 * stamped it. Both are the difference between drift detection that reports something
 * and drift detection everybody has learned to ignore.
 *
 * @param {string} content Rendered seed content, or a file read from disk.
 * @returns {string} `sha256:` followed by the lowercase hex digest.
 */
export function contentSha(content) {
  return `sha256:${createHash('sha256').update(stripMarker(toLf(content)), 'utf8').digest('hex')}`
}
