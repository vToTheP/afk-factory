import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import { PKG_ROOT, SEEDS_DIR, listFiles, packageVersion } from '../src/pkg.js'

test('PKG_ROOT points at the package root', () => {
  assert.ok(existsSync(path.join(PKG_ROOT, 'package.json')))
  assert.ok(existsSync(path.join(PKG_ROOT, 'bin', 'afk-factory.js')))
})

test('package paths do not depend on the working directory', () => {
  // Reproduces the shape of an `npx` invocation, where the package lives in a cache
  // directory and the cwd is some unrelated project. The full case can only be proven
  // by actually running through npx; this pins down that nothing reads the cwd.
  const original = process.cwd()
  try {
    process.chdir(os.tmpdir())
    assert.notEqual(path.resolve(process.cwd()), path.resolve(PKG_ROOT))
    assert.ok(existsSync(path.join(PKG_ROOT, 'package.json')))
    assert.ok(existsSync(SEEDS_DIR))
  } finally {
    process.chdir(original)
  }
})

test('the seeds directory exists so the files allowlist ships something', () => {
  assert.ok(existsSync(SEEDS_DIR))
})

test('listFiles returns sorted, slash-separated relative paths', () => {
  const files = listFiles(path.join(PKG_ROOT, 'src'))
  assert.ok(files.includes('pkg.js'))
  assert.deepEqual(files, [...files].sort())
  assert.ok(files.every((f) => !f.includes('\\')))
})

test('packageVersion reads the version of this package', () => {
  assert.match(packageVersion(), /^\d+\.\d+\.\d+/)
})
