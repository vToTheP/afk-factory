import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { SEEDS_DIR } from '../../src/pkg.js'
import { TEMPLATES_DIRNAME, loadCatalog } from '../../src/seeds/catalog.js'
import { placeholders, render } from '../../src/seeds/render.js'

test('render substitutes a declared placeholder', () => {
  assert.equal(render('branch: {{afk:defaultBranch}}', { defaultBranch: 'main' }), 'branch: main')
})

test('render substitutes every occurrence of the same key', () => {
  assert.equal(
    render('{{afk:v}}-{{afk:v}}', { v: '1' }),
    '1-1',
  )
})

test('render reports every missing key at once', () => {
  // One error per run, not one per invocation: the caller is a scheduled job, and
  // discovering the next missing value only after supplying the previous one turns a
  // single fix into a sequence of failed runs.
  assert.throws(
    () => render('{{afk:one}} {{afk:two}} {{afk:three}}', { two: 'x' }),
    (err) => {
      assert.match(String(err), /one/)
      assert.match(String(err), /three/)
      assert.doesNotMatch(String(err), /two/)
      return true
    },
  )
})

test('render refuses to leave an unresolved placeholder in the output', () => {
  assert.throws(() => render('{{afk:missing}}', {}), /missing/)
})

test('render rejects a value that is not a string', () => {
  for (const value of [18, null, undefined, {}, ['a']]) {
    assert.throws(() => render('{{afk:v}}', { v: value }), /string/, `accepted ${String(value)}`)
  }
})

test('render leaves a GitHub Actions expression alone', () => {
  // The reason the placeholder syntax carries the afk: prefix at all. A renderer
  // matching bare {{ ... }} would eat the one expression the workflow seed cannot
  // do without, and the failure would only show up in a real Actions run.
  const template = 'GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\nversion: {{afk:v}}'
  assert.equal(render(template, { v: '1' }), 'GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\nversion: 1')
})

test('render escapes a value so it cannot break out of a JSON string', () => {
  assert.equal(render('"{{afk:v}}"', { v: 'a"b' }), '"a\\"b"')
  assert.equal(render('"{{afk:v}}"', { v: 'a\\b' }), '"a\\\\b"')
  assert.equal(JSON.parse(render('{"k": "{{afk:v}}"}', { v: 'a"b\\c' })).k, 'a"b\\c')
})

test('render escapes every character that could start a new line', () => {
  // The structural attack on a YAML seed: a newline in a value ends the scalar and
  // whatever follows is parsed as a sibling key. NEL, LINE SEPARATOR and PARAGRAPH
  // SEPARATOR are line breaks to a YAML parser but pass through JSON.stringify raw,
  // so they are escaped explicitly rather than inherited.
  assert.equal(render('{{afk:v}}', { v: 'a\nb' }), 'a\\nb')
  assert.equal(render('{{afk:v}}', { v: 'a\rb' }), 'a\\rb')
  assert.equal(render('{{afk:v}}', { v: 'a\u0085b' }), 'a\\u0085b')
  assert.equal(render('{{afk:v}}', { v: 'a\u2028b' }), 'a\\u2028b')
  assert.equal(render('{{afk:v}}', { v: 'a\u2029b' }), 'a\\u2029b')
  for (const rendered of ['a\nb', 'a\u2028b'].map((v) => render('{{afk:v}}', { v }))) {
    assert.equal(rendered.split(/[\n\r\u0085\u2028\u2029]/).length, 1)
  }
})

test('render passes a single quote through, since the context is double quoted', () => {
  // A gate command with a quoted argument is an ordinary thing to configure. Neither a
  // JSON string nor a YAML double-quoted scalar requires an escape for it, and the
  // template contract guarantees the placeholder sits in one of those.
  assert.equal(render('run: "{{afk:v}}"', { v: "echo 'hello'" }), `run: "echo 'hello'"`)
  assert.equal(
    JSON.parse(render('{"k": "{{afk:v}}"}', { v: "npm test -- --grep 'slow'" })).k,
    "npm test -- --grep 'slow'",
  )
})

test('render does not substitute inside a substituted value', () => {
  // A value is data, not template source. Rendering the output again would let a
  // value supplied on the command line reach for a key it was never given.
  assert.equal(render('{{afk:a}}', { a: '{{afk:b}}', b: 'secret' }), '{{afk:b}}')
})

test('render rejects a malformed placeholder instead of shipping it', () => {
  // Left in place, this reaches the target project as literal text in a config file.
  assert.throws(() => render('{{afk:}}', {}), /malformed/)
  assert.throws(() => render('{{afk:not a key}}', {}), /malformed/)
})

test('render ignores values the template does not use', () => {
  // Values are collected once for every seed; each template uses a subset.
  assert.equal(render('{{afk:a}}', { a: '1', unused: '2' }), '1')
})

test('placeholders lists the keys a template needs, deduplicated and in order', () => {
  assert.deepEqual(placeholders('{{afk:b}} {{afk:a}} {{afk:b}}'), ['b', 'a'])
  assert.deepEqual(placeholders('nothing here'), [])
})

/** @param {string} source */
const template = (source) => readFileSync(path.join(SEEDS_DIR, TEMPLATES_DIRNAME, source), 'utf8')

test('the config seed renders to parseable JSON', () => {
  const rendered = render(template('afk-factory.json.tmpl'), {
    defaultBranch: 'main',
    lintCommand: 'npm run lint',
    testCommand: 'npm test -- --reporter "dot"',
    buildCommand: 'npm run build',
  })
  const config = JSON.parse(rendered)
  assert.equal(config.defaultBranch, 'main')
  assert.equal(config.gates.test, 'npm test -- --reporter "dot"')
})

test('the workflow seed renders without disturbing its Actions expression', () => {
  const rendered = render(template('workflows/afk-run.yml.tmpl'), {
    defaultBranch: 'main',
    nodeVersion: '20',
    engineVersion: '0.0.0',
  })
  assert.ok(rendered.includes('${{ secrets.GITHUB_TOKEN }}'))
  assert.ok(rendered.includes('- "main"'))
  assert.ok(rendered.includes('npx --yes afk-factory@0.0.0 run'))
  assert.ok(!rendered.includes('{{afk:'))
})

test('every placeholder in every packaged template sits inside double quotes', () => {
  // The template contract, enforced rather than documented. The renderer escapes values
  // with one rule and no branches, which is only correct because the quoting style
  // around a placeholder is known. Left as a convention, the first seed added by
  // somebody who has not read the module comment would break it silently — and the
  // symptom would be a mangled workflow in a stranger's repository, not a failing test.
  // What has to hold is that the placeholder is *inside* a double-quoted scalar, not
  // that it fills one: `run: "npx afk-factory@{{afk:engineVersion}} run"` is fine. With
  // no YAML parser available, the check counts quotes on the line — an odd number
  // before the placeholder means it opened a string that has not closed yet. That is
  // sound for these templates because none of them uses a multi-line scalar.
  for (const entry of loadCatalog()) {
    for (const [number, line] of template(entry.source).split('\n').entries()) {
      for (const match of line.matchAll(/\{\{afk:[A-Za-z][A-Za-z0-9]*\}\}/g)) {
        const quotesBefore = (line.slice(0, match.index).match(/"/g) ?? []).length
        const where = `${entry.source}:${number + 1}: ${match[0]}`
        assert.equal(quotesBefore % 2, 1, `${where} is not inside a double-quoted scalar`)
        assert.equal((line.match(/"/g) ?? []).length % 2, 0, `${where} sits on a line with an unbalanced quote`)
      }
    }
  }
})
