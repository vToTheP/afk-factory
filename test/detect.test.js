import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { detectValues } from '../src/detect.js'
import { packageVersion } from '../src/pkg.js'

function project(/** @type {Record<string, string>} */ files) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'afk-detect-')))
  test.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content)
  return dir
}

test('detectValues always knows the version of the engine that is running', () => {
  // Not detected from the project: it is a fact about this package, and it ends up in
  // the workflow as the version npx will install.
  assert.equal(detectValues(project({})).engineVersion, packageVersion())
})

test('detectValues reads the node version from .nvmrc', () => {
  assert.equal(detectValues(project({ '.nvmrc': 'v20.11.0\n' })).nodeVersion, '20.11.0')
})

test('detectValues falls back to the engines range in package.json', () => {
  const dir = project({ 'package.json': JSON.stringify({ engines: { node: '>=18' } }) })
  assert.equal(detectValues(dir).nodeVersion, '18')
})

test('detectValues prefers .nvmrc, which is the file that pins a version', () => {
  // engines is a range and .nvmrc is a pin. A range cannot be written into setup-node
  // without picking a member of it, and picking one is a decision this tool does not get
  // to make quietly.
  const dir = project({ '.nvmrc': '20\n', 'package.json': JSON.stringify({ engines: { node: '>=18' } }) })
  assert.equal(detectValues(dir).nodeVersion, '20')
})

test('detectValues takes gate commands from the scripts that exist', () => {
  const dir = project({ 'package.json': JSON.stringify({ scripts: { lint: 'eslint .', test: 'node --test' } }) })
  const values = detectValues(dir)
  assert.equal(values.lintCommand, 'npm run lint')
  assert.equal(values.testCommand, 'npm test')
  assert.equal(values.buildCommand, undefined)
})

test('detectValues reports nothing it could not determine', () => {
  // Absent rather than guessed. A value invented here would be written into a committed
  // workflow, and the first sign of it would be a red run in somebody else's repository.
  const values = detectValues(project({}))
  assert.equal(values.nodeVersion, undefined)
  assert.equal(values.lintCommand, undefined)
  assert.equal(values.defaultBranch, undefined)
})

test('detectValues survives a package.json it cannot read', () => {
  // A broken package.json is the project's problem to fix, but it is not a reason for
  // init to fall over: everything here is a convenience, and the values can be supplied.
  const dir = project({ 'package.json': '{ not json' })
  assert.doesNotThrow(() => detectValues(dir))
  assert.equal(detectValues(dir).nodeVersion, undefined)
})
