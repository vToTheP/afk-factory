/**
 * Template rendering for seeds.
 *
 * Pure: a template and a set of values in, a string out. Nothing here reads the
 * filesystem or knows which project it is rendering for, which is what lets `init` and
 * a later `update` produce the same bytes for the same inputs — the property the whole
 * manifest depends on, since the recorded hash is taken over rendered content.
 *
 * ## Why values are escaped rather than interpolated
 *
 * Values reach this function from `--set` on the command line and from probing the
 * repository, and they land inside structured files: a JSON config and a YAML workflow.
 * A raw newline in a value does not produce a broken file, it produces a *valid* one
 * with content nobody wrote — in YAML the scalar ends and the next line is parsed as a
 * sibling key, so a value can introduce a step, a permission, or a `run:` command.
 *
 * A YAML parser would be the obvious fix and is not available: this package ships no
 * runtime dependencies, and hand-rolling one to make quoting safe would be a far larger
 * surface than the escaping it replaces.
 *
 * So the rule is deliberately narrow. Every value is escaped with JSON string rules,
 * which is exactly right inside a JSON string and removes every control character, so
 * no value can start a new line in any format. The characters that a YAML parser also
 * treats as line breaks but that `JSON.stringify` passes through untouched are escaped
 * explicitly. And the single quote is refused outright: YAML escapes it by doubling,
 * JSON by a backslash, and this function cannot see which context a placeholder sits in
 * — so rather than guess wrong in one of the two, it declines the one character where
 * the two disagree.
 *
 * This is not a defence against a hostile operator. Someone who can pass `--set` can
 * usually run commands anyway; gate commands are shell strings by design. It is a
 * defence against a value that quietly restructures a file — a branch name pasted with
 * a trailing newline is the realistic case, and it would otherwise be written into a
 * workflow and only diagnosed in a failing Actions run.
 */

const KEY_PATTERN = '[A-Za-z][A-Za-z0-9]*'

/**
 * The `afk:` prefix is not decoration. GitHub Actions expressions are `${{ … }}`, and a
 * renderer matching bare `{{ … }}` would consume `${{ secrets.GITHUB_TOKEN }}` in the
 * workflow seed — a seed that cannot be rendered without it.
 */
const placeholderPattern = () => new RegExp(`\\{\\{afk:(${KEY_PATTERN})\\}\\}`, 'g')

/** Anything opening a placeholder that the pattern above did not accept. */
const MALFORMED = /\{\{afk:/

/** Line breaks to a YAML parser that `JSON.stringify` leaves as literal characters. */
const UNESCAPED_BREAKS = /[\u0085\u2028\u2029]/g

const SINGLE_QUOTE = "'"

/**
 * Lists the keys a template needs.
 *
 * Deduplicated, in order of first appearance. Used to tell a caller what to supply
 * before anything is written, rather than one missing value per failed run.
 *
 * @param {string} template Template source.
 * @returns {string[]} Placeholder keys, without the `afk:` prefix.
 */
export function placeholders(template) {
  /** @type {string[]} */
  const keys = []
  for (const match of template.matchAll(placeholderPattern())) {
    const key = match[1]
    if (key !== undefined && !keys.includes(key)) keys.push(key)
  }
  return keys
}

/**
 * Escapes one value for insertion into a structured file.
 *
 * @param {string} key Placeholder key, for the error message.
 * @param {unknown} value
 * @returns {string}
 */
function escapeValue(key, value) {
  if (typeof value !== 'string') {
    throw new Error(`template value "${key}" must be a string, got ${value === null ? 'null' : typeof value}`)
  }
  if (value.includes(SINGLE_QUOTE)) {
    throw new Error(
      `template value "${key}" must not contain a single quote: ${value}\n` +
        'The escape for it differs between JSON and YAML and the renderer cannot tell ' +
        'the two apart here. Use a double quote instead.',
    )
  }
  // `.slice(1, -1)` drops the quotes JSON.stringify adds: the template supplies its own
  // quoting, and the placeholder sits inside it.
  return JSON.stringify(value)
    .slice(1, -1)
    .replace(UNESCAPED_BREAKS, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

/**
 * Renders a template.
 *
 * Fails rather than degrades, in both directions: a placeholder without a value throws
 * instead of being left in place, and a value is never itself scanned for placeholders.
 * A leftover `{{afk:…}}` would be written into somebody's repository as literal text
 * and read as a defect in the tool; a value rendered as a template would let something
 * supplied on the command line reach a key it was never given.
 *
 * Values the template does not use are ignored. Values are collected once per run and
 * each seed uses a subset of them.
 *
 * @param {string} template Template source.
 * @param {Record<string, unknown>} values Values by placeholder key.
 * @returns {string} The rendered content.
 * @throws {Error} If a key is missing, a value is not a string, a value contains a
 *   single quote, or the template holds a malformed placeholder.
 */
export function render(template, values) {
  // Checked before substituting, not after: a well-formed placeholder is gone by then,
  // and a *value* containing `{{afk:` is legitimate output, not a malformed template.
  if (MALFORMED.test(template.replace(placeholderPattern(), ''))) {
    throw new Error(`malformed placeholder in template: expected {{afk:key}} with key matching ${KEY_PATTERN}`)
  }

  const missing = placeholders(template).filter(
    (key) => !Object.prototype.hasOwnProperty.call(values, key),
  )
  if (missing.length > 0) {
    throw new Error(`missing template ${missing.length === 1 ? 'value' : 'values'}: ${missing.join(', ')}`)
  }

  return template.replace(placeholderPattern(), (_match, key) => escapeValue(key, values[key]))
}
