/**
 * Facts about the configuration file that other modules need before one exists.
 */

/**
 * Schema version of `.afk-factory.json`.
 *
 * Written into the manifest and into the configuration file itself, and interpreted by
 * neither: it exists so that a later release can tell which shape it is looking at
 * without guessing. Bumping it is a decision about migration, not a formality.
 *
 * The seed template carries the same number as a literal, because the renderer's
 * contract puts every placeholder inside double quotes and this field is a number.
 * `test/config.test.js` compares the two, so the copy cannot drift unnoticed.
 */
export const CONFIG_VERSION = 1

/** Name of the configuration file in the target project. */
export const CONFIG_FILENAME = '.afk-factory.json'
