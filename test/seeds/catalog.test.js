import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  CATALOG_FILENAME,
  MARKER_TYPES,
  SEED_CLASSES,
  TEMPLATES_DIRNAME,
  loadCatalog,
  parseCatalog,
} from '../../src/seeds/catalog.js'

const BACKSLASH = String.fromCharCode(92)

/**
 * Fixtures are built per test rather than shared, so a test that asserts on one class or
 * one marker type never depends on the real catalog staying the shape it has today.
 *
 * @param {Record<string, unknown>} [overrides]
 */
const entry = (overrides = {}) => ({
  source: 'thing.json.tmpl',
  target: 'thing.json',
  class: 'seed-once',
  marker: 'none',
  ...overrides,
})

/** @param {Record<string, unknown>[]} seeds */
const catalog = (...seeds) => ({ seeds })

test('parseCatalog returns the declared entries, sorted by target', () => {
  const entries = parseCatalog(
    catalog(
      entry({ source: 'z.tmpl', target: 'z.json' }),
      entry({ source: 'a.tmpl', target: 'a.json' }),
    ),
  )
  assert.deepEqual(
    entries.map((e) => e.target),
    ['a.json', 'z.json'],
  )
  assert.equal(entries[0]?.source, 'a.tmpl')
})

test('parseCatalog rejects a document that is not a seed catalog', () => {
  assert.throws(() => parseCatalog(null), /object/)
  assert.throws(() => parseCatalog({}), /seeds/)
  assert.throws(() => parseCatalog({ seeds: {} }), /array/)
})

test('parseCatalog rejects an unknown seed class instead of defaulting', () => {
  assert.throws(() => parseCatalog(catalog(entry({ class: 'shared' }))), /class/)
  assert.throws(() => parseCatalog(catalog(entry({ class: undefined }))), /class/)
})

test('parseCatalog rejects an unknown marker type', () => {
  assert.throws(() => parseCatalog(catalog(entry({ marker: 'slashes' }))), /marker/)
  assert.throws(() => parseCatalog(catalog(entry({ marker: undefined }))), /marker/)
})

test('a managed seed must carry a marker', () => {
  // A managed file is overwritten on update, so a human finding it in a diff needs the
  // file itself to say where it came from.
  assert.throws(
    () => parseCatalog(catalog(entry({ class: 'managed', marker: 'none' }))),
    /managed/,
  )
  assert.equal(
    parseCatalog(catalog(entry({ class: 'managed', marker: 'hash' })))[0]?.marker,
    'hash',
  )
})

test('a seed-once seed must not carry a marker', () => {
  // The engine never touches the file again, so a marker on it would state a version
  // that stops being true at the next release and can never be corrected. Forbidding it
  // here keeps marker-aware code from being written for files nothing revisits.
  for (const marker of ['hash', 'html']) {
    assert.throws(
      () => parseCatalog(catalog(entry({ class: 'seed-once', marker }))),
      /seed-once/,
      `accepted marker ${marker}`,
    )
  }
  assert.equal(
    parseCatalog(catalog(entry({ class: 'seed-once', marker: 'none' })))[0]?.marker,
    'none',
  )
})

test('parseCatalog rejects an unknown field, which is usually a typo', () => {
  assert.throws(() => parseCatalog(catalog({ ...entry(), klass: 'managed' })), /klass/)
})

test('parseCatalog rejects duplicate targets and duplicate sources', () => {
  assert.throws(
    () => parseCatalog(catalog(entry({ source: 'a.tmpl' }), entry({ source: 'b.tmpl' }))),
    /duplicate target/,
  )
  assert.throws(
    () => parseCatalog(catalog(entry({ target: 'a.json' }), entry({ target: 'b.json' }))),
    /duplicate source/,
  )
})

test('parseCatalog rejects a target that could escape the project root', () => {
  // These paths are joined onto the target project's root and then written to. A path
  // that escapes it writes into someone's home directory instead of their repository.
  for (const target of ['/etc/passwd', `C:${BACKSLASH}Windows`, '../outside.json', 'a/../../b.json']) {
    assert.throws(() => parseCatalog(catalog(entry({ target }))), /target/, `accepted ${target}`)
  }
})

test('parseCatalog rejects backslashes, so keys are identical on every platform', () => {
  assert.throws(() => parseCatalog(catalog(entry({ target: `.github${BACKSLASH}x.yml` }))), /target/)
  assert.throws(() => parseCatalog(catalog(entry({ source: `workflows${BACKSLASH}x.tmpl` }))), /source/)
})

test('parseCatalog rejects a relative path that is not normalised', () => {
  assert.throws(() => parseCatalog(catalog(entry({ target: './thing.json' }))), /target/)
  assert.throws(() => parseCatalog(catalog(entry({ target: '' }))), /target/)
})

/**
 * Writes a throwaway seeds directory and returns its path.
 *
 * @param {Record<string, unknown>} doc Catalog document to serialise.
 * @param {string[]} templates Template files to create below `templates/`.
 */
function seedsFixture(doc, templates) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'afk-catalog-'))
  test.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(path.join(dir, CATALOG_FILENAME), JSON.stringify(doc))
  for (const rel of templates) {
    const abs = path.join(dir, TEMPLATES_DIRNAME, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, 'content\n')
  }
  return dir
}

test('loadCatalog fails on an entry whose template file is missing', () => {
  const dir = seedsFixture(catalog(entry({ source: 'gone.tmpl' })), ['other.tmpl'])
  assert.throws(() => loadCatalog(dir), /gone\.tmpl/)
})

test('loadCatalog fails on a template file that no entry declares', () => {
  const dir = seedsFixture(catalog(entry({ source: 'declared.tmpl' })), [
    'declared.tmpl',
    'workflows/orphan.tmpl',
  ])
  assert.throws(() => loadCatalog(dir), /workflows\/orphan\.tmpl/)
})

test('loadCatalog accepts a catalog whose files line up exactly', () => {
  const dir = seedsFixture(
    catalog(entry({ source: 'workflows/x.tmpl', target: '.github/workflows/x.yml', class: 'managed', marker: 'hash' })),
    ['workflows/x.tmpl'],
  )
  assert.equal(loadCatalog(dir).length, 1)
})

test('loadCatalog reports a missing catalog by path rather than by ENOENT', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'afk-catalog-'))
  test.after(() => rmSync(dir, { recursive: true, force: true }))
  assert.throws(() => loadCatalog(dir), /catalog/)
})

test('the packaged catalog is valid and ships both ownership classes', () => {
  // Patient zero: the two real seeds this package was built around. If either class
  // disappears from the catalog, the manifest stops being exercised end to end.
  const entries = loadCatalog()
  const classes = new Set(entries.map((e) => e.class))
  for (const seedClass of SEED_CLASSES) assert.ok(classes.has(seedClass), `no ${seedClass} seed`)
  assert.ok(entries.every((e) => MARKER_TYPES.includes(e.marker)))
})

test('every path loadCatalog returns is POSIX, whatever the host separator', () => {
  // The post-condition the manifest depends on. These strings become keys in a file
  // that is committed and read on every machine in a team: one backslash and a Windows
  // checkout reports drift on a file nobody touched.
  for (const entry of loadCatalog()) {
    assert.ok(!entry.target.includes(BACKSLASH), `backslash in target ${entry.target}`)
    assert.ok(!entry.source.includes(BACKSLASH), `backslash in source ${entry.source}`)
  }
})

test('the packaged catalog seeds the config file and a workflow shell', () => {
  const byTarget = new Map(loadCatalog().map((e) => [e.target, e]))
  assert.equal(byTarget.get('.afk-factory.json')?.class, 'seed-once')
  assert.equal(byTarget.get('.github/workflows/afk-run.yml')?.class, 'managed')
})
