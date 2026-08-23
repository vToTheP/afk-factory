import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MARKER_TAG, applyMarker, contentSha, markerLine, stripMarker } from '../../src/seeds/marker.js'

const CRLF = '\r\n'

test('contentSha returns a prefixed sha256 digest', () => {
  assert.match(contentSha('hello\n'), /^sha256:[0-9a-f]{64}$/)
})

test('contentSha distinguishes different content', () => {
  assert.notEqual(contentSha('a\n'), contentSha('b\n'))
})

test('contentSha is the same whatever the line endings are', () => {
  // Git checks out with CRLF on a Windows machine by default. Without this, one
  // developer's clone reports every seeded file as drifted and the other's does not,
  // and the manifest is committed so both are looking at the same recorded hash.
  const lf = 'one\ntwo\nthree\n'
  assert.equal(contentSha(lf), contentSha(lf.split('\n').join(CRLF)))
})

test('contentSha ignores the marker line', () => {
  // The acceptance criterion the whole marker split exists for: a released version
  // stamps a new marker into every managed file, and if that counted, every file would
  // read as drifted on every release and the signal would be worthless.
  const content = 'name: x\n'
  const withOne = applyMarker('hash', content, 'sha256:' + 'a'.repeat(64))
  const withAnother = applyMarker('hash', content, 'sha256:' + 'b'.repeat(64))
  assert.notEqual(withOne, withAnother)
  assert.equal(contentSha(withOne), contentSha(content))
  assert.equal(contentSha(withOne), contentSha(withAnother))
})

test('contentSha ignores a marker written with CRLF line endings', () => {
  const content = 'name: x\n'
  const stamped = applyMarker('hash', content, contentSha(content))
  assert.equal(contentSha(stamped.split('\n').join(CRLF)), contentSha(content))
})

test('markerLine renders the hash comment form', () => {
  assert.equal(markerLine('hash', 'sha256:abc'), `# ${MARKER_TAG}: sha256:abc`)
})

test('markerLine renders the html comment form', () => {
  assert.equal(markerLine('html', 'sha256:abc'), `<!-- ${MARKER_TAG}: sha256:abc -->`)
})

test('markerLine has nothing to render for a format without comments', () => {
  assert.equal(markerLine('none', 'sha256:abc'), null)
})

test('applyMarker puts the marker on the first line', () => {
  const out = applyMarker('hash', 'name: x\n', 'sha256:abc')
  assert.equal(out.split('\n')[0], `# ${MARKER_TAG}: sha256:abc`)
  assert.ok(out.endsWith('name: x\n'))
})

test('applyMarker leaves content alone when the format carries no comment', () => {
  assert.equal(applyMarker('none', '{}\n', 'sha256:abc'), '{}\n')
})

test('applyMarker replaces an existing marker rather than stacking one on top', () => {
  // init writes; update rewrites. Stacking would grow the file by a line per release.
  const once = applyMarker('hash', 'name: x\n', 'sha256:one')
  const twice = applyMarker('hash', once, 'sha256:two')
  assert.equal(twice, applyMarker('hash', 'name: x\n', 'sha256:two'))
  assert.equal(twice.split(MARKER_TAG).length - 1, 1)
})

test('applyMarker matches the line ending of the content it stamps', () => {
  // A hardcoded LF would leave a CRLF file with exactly one LF line ending. Mixed
  // endings make Git warn and make an editor normalise the whole file on the next save
  // — and that save then reads as drift in a file nobody meant to touch.
  const out = applyMarker('hash', `name: x${CRLF}jobs: {}${CRLF}`, 'sha256:abc')
  assert.equal(out.split(CRLF)[0], `# ${MARKER_TAG}: sha256:abc`)
  assert.equal(out.split('\n').length, out.split(CRLF).length)
})

test('applyMarker keeps CRLF when it replaces a marker it wrote before', () => {
  const once = applyMarker('hash', `name: x${CRLF}`, 'sha256:one')
  const twice = applyMarker('hash', once, 'sha256:two')
  assert.equal(twice, applyMarker('hash', `name: x${CRLF}`, 'sha256:two'))
  assert.equal(twice.split('\n').length, twice.split(CRLF).length)
})

test('applyMarker uses LF for content that has no line ending of its own', () => {
  assert.equal(applyMarker('hash', 'name: x', 'sha256:abc'), `# ${MARKER_TAG}: sha256:abc\nname: x`)
})

test('stripMarker returns content without a marker unchanged', () => {
  // Reached on every file a user wrote by hand and on every JSON seed, so this is the
  // common path, not the edge case.
  for (const content of ['', 'name: x\n', '{\n  "a": 1\n}\n', '# an ordinary comment\n']) {
    assert.equal(stripMarker(content), content)
  }
})

test('stripMarker is idempotent', () => {
  const once = stripMarker(applyMarker('hash', 'name: x\n', 'sha256:abc'))
  assert.equal(stripMarker(once), once)
})

test('stripMarker removes either comment form', () => {
  for (const type of /** @type {const} */ (['hash', 'html'])) {
    assert.equal(stripMarker(applyMarker(type, 'body\n', 'sha256:abc')), 'body\n')
  }
})

test('stripMarker leaves a comment that merely looks similar', () => {
  const content = '# afk-factory writes this file\n'
  assert.equal(stripMarker(content), content)
})

test('a stamped file round-trips: strip gives back exactly what was stamped', () => {
  const content = 'name: x\njobs: {}\n'
  const sha = contentSha(content)
  assert.equal(stripMarker(applyMarker('hash', content, sha)), content)
  assert.equal(contentSha(applyMarker('hash', content, sha)), sha)
})
