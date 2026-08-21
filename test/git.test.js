import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { UserError } from '../src/errors.js'
import { currentBranch, repoRoot } from '../src/git.js'

function tmpDir(prefix = 'afk-git-') {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)))
  test.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function tmpRepo() {
  const dir = tmpDir()
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  return dir
}

test('repoRoot finds the root from a directory below it', () => {
  // The reason this exists at all: .github/workflows is only a workflow when it sits at
  // the root of the repository. Seeding relative to the working directory would write
  // files GitHub never looks at, and nothing about the result would say so.
  const root = tmpRepo()
  const nested = path.join(root, 'packages', 'web')
  mkdirSync(nested, { recursive: true })
  assert.equal(repoRoot(nested), root)
  assert.equal(repoRoot(root), root)
})

test('repoRoot fails with a sentence rather than a stack outside a repository', () => {
  assert.throws(
    () => repoRoot(tmpDir()),
    (err) => {
      assert.ok(err instanceof UserError)
      assert.match(err.message, /not a git repository/i)
      // What an unwrapped execFileSync failure would have said instead.
      assert.ok(!err.message.includes('Command failed'))
      return true
    },
  )
})

test('currentBranch reports the branch, and nothing outside a repository', () => {
  assert.equal(currentBranch(tmpRepo()), 'main')
  assert.equal(currentBranch(tmpDir()), undefined)
})
