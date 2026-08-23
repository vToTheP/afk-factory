import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  MANIFEST_FILENAME,
  MANIFEST_WARNING,
  mergeManifest,
  parseManifest,
  readManifest,
  serialiseManifest,
  writeManifest,
} from '../src/manifest.js'

const SHA_A = 'sha256:' + 'a'.repeat(64)
const SHA_B = 'sha256:' + 'b'.repeat(64)
const BACKSLASH = String.fromCharCode(92)

/** @param {Record<string, unknown>} [overrides] */
const doc = (overrides = {}) => ({
  engineVersion: '1.0.0',
  configVersion: 1,
  seeds: { '.afk-factory.json': { class: 'seed-once', sha: SHA_A, seededBy: '1.0.0' } },
  ...overrides,
})

/** @param {Record<string, unknown>} [overrides] */
const entry = (overrides = {}) => ({ class: 'seed-once', sha: SHA_A, seededBy: '1.0.0', ...overrides })

/** @param {Record<string, unknown>} [overrides] */
const result = (overrides = {}) => ({
  target: '.afk-factory.json',
  class: 'seed-once',
  sha: SHA_B,
  outcome: 'written',
  ...overrides,
})

/** @param {Record<string, unknown>} [overrides] */
const merged = (overrides = {}) =>
  mergeManifest({ existing: null, results: [], engineVersion: '2.0.0', configVersion: 1, ...overrides })

function tmpProject() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'afk-manifest-'))
  test.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('parseManifest returns the document it validated', () => {
  assert.deepEqual(parseManifest(doc()), {
    engineVersion: '1.0.0',
    configVersion: 1,
    seeds: { '.afk-factory.json': entry() },
  })
})

test('parseManifest keeps an entry for a file this package no longer ships', () => {
  // An orphan is the only record that we ever delivered the file. update needs it to
  // report the seed as deprecated; deleting it here would leave the file in somebody's
  // repository with nothing anywhere saying where it came from.
  const orphan = { class: 'managed', sha: SHA_B, seededBy: '0.9.0' }
  const parsed = parseManifest(doc({ seeds: { 'gone.yml': orphan } }))
  assert.deepEqual(parsed.seeds, { 'gone.yml': orphan })
})

test('parseManifest ignores the warning it writes for humans', () => {
  const parsed = parseManifest({ _warning: 'anything at all', ...doc() })
  assert.deepEqual(Object.keys(parsed), ['engineVersion', 'configVersion', 'seeds'])
})

test('parseManifest rejects a document that is not a manifest', () => {
  assert.throws(() => parseManifest(null), /object/)
  assert.throws(() => parseManifest([]), /object/)
  assert.throws(() => parseManifest(doc({ engineVersion: undefined })), /engineVersion/)
  assert.throws(() => parseManifest(doc({ engineVersion: 1 })), /engineVersion/)
  assert.throws(() => parseManifest(doc({ configVersion: '1' })), /configVersion/)
  assert.throws(() => parseManifest(doc({ configVersion: 1.5 })), /configVersion/)
  assert.throws(() => parseManifest(doc({ seeds: undefined })), /seeds/)
  assert.throws(() => parseManifest(doc({ seeds: [] })), /seeds/)
})

test('parseManifest rejects an entry that could not have been written by this tool', () => {
  const bad = (/** @type {unknown} */ value) => doc({ seeds: { 'a.json': value } })
  assert.throws(() => parseManifest(bad(null)), /a\.json/)
  assert.throws(() => parseManifest(bad(entry({ class: 'shared' }))), /class/)
  assert.throws(() => parseManifest(bad(entry({ sha: 'abc' }))), /sha/)
  assert.throws(() => parseManifest(bad(entry({ sha: 'sha256:XYZ' }))), /sha/)
  assert.throws(() => parseManifest(bad(entry({ seededBy: undefined }))), /seededBy/)
  assert.throws(() => parseManifest(bad(entry({ extra: true }))), /extra/)
})

test('parseManifest rejects a key that is not a project-relative path', () => {
  // These keys are joined onto a project root and compared against catalog targets. A
  // manifest is committed, so a hand-merged one reaches this function with whatever a
  // conflict resolution left behind.
  const key = (/** @type {string} */ k) => doc({ seeds: { [k]: entry() } })
  assert.throws(() => parseManifest(key('/etc/passwd')), /relative/)
  assert.throws(() => parseManifest(key('../outside.json')), /normalised/)
  assert.throws(() => parseManifest(key('.github' + BACKSLASH + 'x.yml')), /separator/)
})

test('mergeManifest records what was written with the sha and version that wrote it', () => {
  const out = merged({ results: [result({ outcome: 'written' })] })
  assert.deepEqual(out.seeds['.afk-factory.json'], { class: 'seed-once', sha: SHA_B, seededBy: '2.0.0' })
})

test('mergeManifest adopts an untouched file with the sha of the seed, never of the file', () => {
  // ADR 0001: base means what the engine delivered. There is deliberately nowhere in a
  // result to put the bytes on disk, so the wrong value cannot be passed in.
  const out = merged({ results: [result({ outcome: 'adopted' })] })
  assert.deepEqual(out.seeds['.afk-factory.json'], { class: 'seed-once', sha: SHA_B, seededBy: '2.0.0' })
})

test('mergeManifest leaves a skipped entry exactly as it was', () => {
  // The no-restamping criterion. Backdating sha or seededBy to the current version makes
  // a local modification read as up to date, and the next update overwrites it silently.
  const out = merged({ existing: doc(), results: [result({ outcome: 'skipped' })] })
  assert.deepEqual(out.seeds['.afk-factory.json'], entry())
})

test('mergeManifest restamps an entry whose file was rewritten', () => {
  // The file was deleted from disk, so init wrote it again — with the content of the
  // version running now. Keeping the old entry would claim a sha that is not on disk,
  // and every later comparison would report drift in a file nobody edited.
  const out = merged({ existing: doc(), results: [result({ outcome: 'written' })] })
  assert.deepEqual(out.seeds['.afk-factory.json'], { class: 'seed-once', sha: SHA_B, seededBy: '2.0.0' })
})

test('mergeManifest keeps entries no result mentions', () => {
  const orphan = { class: 'managed', sha: SHA_A, seededBy: '0.9.0' }
  const out = merged({ existing: doc({ seeds: { 'gone.yml': orphan } }), results: [result()] })
  assert.deepEqual(out.seeds['gone.yml'], orphan)
  assert.deepEqual(Object.keys(out.seeds).sort(), ['.afk-factory.json', 'gone.yml'])
})

test('mergeManifest records the versions that are running now', () => {
  // Top level, so it says which engine last maintained the file. Per-entry versions are
  // the ones that must not move; this one carries no claim about any file.
  const out = merged({ existing: doc(), results: [] })
  assert.equal(out.engineVersion, '2.0.0')
  assert.equal(out.configVersion, 1)
})

test('mergeManifest refuses to skip a file it has no entry for', () => {
  // Not defensiveness about user input: a file that exists without an entry is an
  // adoption, and a caller reporting it as skipped would drop it from the manifest
  // entirely — the one outcome that loses a file silently.
  assert.throws(() => merged({ results: [result({ outcome: 'skipped' })] }), /no entry/)
})

test('mergeManifest rejects an outcome it does not know', () => {
  assert.throws(() => merged({ results: [result({ outcome: 'overwritten' })] }), /outcome/)
})

test('serialiseManifest puts the warning first', () => {
  // A generated state file that people will hand-merge through Git conflicts. The
  // warning is the only thing standing between that and a silently wrong sha.
  const text = serialiseManifest(merged({ results: [result()] }))
  assert.ok(text.startsWith('{\n  "_warning": '))
  assert.equal(JSON.parse(text)._warning, MANIFEST_WARNING)
  assert.deepEqual(Object.keys(JSON.parse(text)), ['_warning', 'engineVersion', 'configVersion', 'seeds'])
})

test('serialiseManifest is byte-identical for the same manifest, whatever the insertion order', () => {
  // init twice must not produce a diff. Key order in a committed file is not cosmetic:
  // one that reorders itself cannot be reviewed.
  const a = merged({ results: [result({ target: 'b.json' }), result({ target: 'a.json' })] })
  const b = merged({ results: [result({ target: 'a.json' }), result({ target: 'b.json' })] })
  assert.equal(serialiseManifest(a), serialiseManifest(b))
  assert.deepEqual(Object.keys(JSON.parse(serialiseManifest(a)).seeds), ['a.json', 'b.json'])
  assert.ok(serialiseManifest(a).endsWith('}\n'))
})

test('serialiseManifest writes each entry with its fields in a fixed order', () => {
  const text = serialiseManifest(merged({ results: [result()] }))
  assert.deepEqual(Object.keys(JSON.parse(text).seeds['.afk-factory.json']), ['class', 'sha', 'seededBy'])
})

test('a serialised manifest parses back to what was serialised', () => {
  const manifest = merged({ existing: doc(), results: [result({ outcome: 'skipped' })] })
  assert.deepEqual(parseManifest(JSON.parse(serialiseManifest(manifest))), manifest)
})

test('readManifest reports nothing rather than failing when a project has none', () => {
  // The normal case on a first init, so it is not an error.
  assert.equal(readManifest(tmpProject()), null)
})

test('readManifest fails on a manifest it cannot read, naming the file', () => {
  const dir = tmpProject()
  writeFileSync(path.join(dir, MANIFEST_FILENAME), '{ not json')
  assert.throws(() => readManifest(dir), new RegExp(MANIFEST_FILENAME.replace('.', '\\.')))

  writeFileSync(path.join(dir, MANIFEST_FILENAME), JSON.stringify({ seeds: {} }))
  assert.throws(() => readManifest(dir), /engineVersion/)
})

test('writeManifest and readManifest round-trip through a project directory', () => {
  const dir = tmpProject()
  const manifest = merged({ results: [result()] })
  writeManifest(dir, manifest)
  assert.deepEqual(readManifest(dir), manifest)
  assert.equal(readFileSync(path.join(dir, MANIFEST_FILENAME), 'utf8'), serialiseManifest(manifest))
})

test('writing the same manifest twice leaves the file unchanged', () => {
  const dir = tmpProject()
  const manifest = merged({ results: [result()] })
  writeManifest(dir, manifest)
  const first = readFileSync(path.join(dir, MANIFEST_FILENAME), 'utf8')
  writeManifest(dir, parseManifest(JSON.parse(first)))
  assert.equal(readFileSync(path.join(dir, MANIFEST_FILENAME), 'utf8'), first)
})
