import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { CONFIG_VERSION } from '../src/config.js'
import init from '../src/init.js'
import { MANIFEST_FILENAME } from '../src/manifest.js'
import { packageVersion } from '../src/pkg.js'
import { contentSha } from '../src/seeds/marker.js'

const CONFIG = '.afk-factory.json'
const WORKFLOW = '.github/workflows/afk-run.yml'

/** Values the fixture project cannot supply, so the tests do not depend on detection. */
const SET = [
  '--set',
  'nodeVersion=20',
  '--set',
  'lintCommand=npm run lint',
  '--set',
  'testCommand=npm test',
  '--set',
  'buildCommand=npm run build',
]

function tmpDir(prefix = 'afk-init-') {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)))
  test.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function tmpRepo() {
  const dir = tmpDir()
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  return dir
}

/**
 * Runs init with its output captured.
 *
 * @param {string[]} argv
 * @param {string} cwd
 * @returns {{ code: number, output: string }}
 */
function run(argv, cwd) {
  /** @type {string[]} */
  const lines = []
  const { log, error } = console
  console.log = (...args) => lines.push(args.join(' '))
  console.error = (...args) => lines.push(args.join(' '))
  try {
    return { code: init(argv, cwd), output: lines.join('\n') }
  } finally {
    console.log = log
    console.error = error
  }
}

/** @param {string} root */
const manifestOf = (root) => JSON.parse(readFileSync(path.join(root, MANIFEST_FILENAME), 'utf8'))

/** @param {string} root @param {string} rel */
const read = (root, rel) => readFileSync(path.join(root, rel), 'utf8')

test('init seeds a repository and records what it delivered', () => {
  const root = tmpRepo()
  const { code, output } = run(SET, root)

  assert.equal(code, 0)
  assert.ok(existsSync(path.join(root, CONFIG)))
  assert.ok(existsSync(path.join(root, WORKFLOW)))
  assert.match(output, /Wrote:\s+\.afk-factory\.json/)

  const manifest = manifestOf(root)
  assert.equal(manifest.engineVersion, packageVersion())
  assert.equal(manifest.configVersion, CONFIG_VERSION)
  assert.deepEqual(Object.keys(manifest.seeds), [CONFIG, WORKFLOW])
  assert.equal(manifest.seeds[WORKFLOW].class, 'managed')
  assert.equal(manifest.seeds[WORKFLOW].seededBy, packageVersion())
  assert.equal(manifest.seeds[WORKFLOW].sha, contentSha(read(root, WORKFLOW)))
})

test('init seeds at the root of the repository, not where it was invoked', () => {
  // A workflow is only a workflow at the root. Seeding into a monorepo package would
  // produce a file GitHub silently ignores.
  const root = tmpRepo()
  const nested = path.join(root, 'packages', 'web')
  mkdirSync(nested, { recursive: true })
  assert.equal(run(SET, nested).code, 0)
  assert.ok(existsSync(path.join(root, WORKFLOW)))
  assert.ok(!existsSync(path.join(nested, WORKFLOW)))
})

test('running init twice changes nothing at all', () => {
  const root = tmpRepo()
  run(SET, root)
  const before = { config: read(root, CONFIG), workflow: read(root, WORKFLOW), manifest: read(root, MANIFEST_FILENAME) }

  const { code, output } = run(SET, root)
  assert.equal(code, 0)
  assert.match(output, /Skipped:\s+\.afk-factory\.json/)
  assert.equal(read(root, CONFIG), before.config)
  assert.equal(read(root, WORKFLOW), before.workflow)
  assert.equal(read(root, MANIFEST_FILENAME), before.manifest)
})

test('init leaves a file that is already there and records the seed it would have written', () => {
  // Adoption. ADR 0001: base is what the engine delivers, so the recorded sha is the
  // sha of the seed. Recording the user's bytes would make the next comparison read
  // mine == base and overwrite hand-written work as a clean update.
  const root = tmpRepo()
  writeFileSync(path.join(root, CONFIG), '{ "mine": true }\n')

  const { code, output } = run(SET, root)
  assert.equal(code, 0)
  assert.match(output, /Adopted:\s+\.afk-factory\.json/)
  assert.equal(read(root, CONFIG), '{ "mine": true }\n')

  const entry = manifestOf(root).seeds[CONFIG]
  assert.notEqual(entry.sha, contentSha('{ "mine": true }\n'))
  assert.equal(entry.seededBy, packageVersion())
})

test('init never overwrites a managed file either', () => {
  const root = tmpRepo()
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true })
  writeFileSync(path.join(root, WORKFLOW), 'name: mine\n')

  assert.match(run(SET, root).output, /Adopted:\s+\.github\/workflows\/afk-run\.yml/)
  assert.equal(read(root, WORKFLOW), 'name: mine\n')
})

test('a file that was deleted is written again and its entry follows the file', () => {
  // The case a merge driven by the plan alone gets wrong: the manifest would keep the
  // old sha while the file on disk holds the content of the version running now, and
  // every later comparison would report drift nobody caused.
  const root = tmpRepo()
  run(SET, root)
  const first = manifestOf(root)
  unlinkSync(path.join(root, WORKFLOW))

  const { code } = run([...SET, '--set', 'defaultBranch=trunk'], root)
  assert.equal(code, 0)

  const second = manifestOf(root)
  assert.ok(read(root, WORKFLOW).includes('trunk'))
  assert.equal(second.seeds[WORKFLOW].sha, contentSha(read(root, WORKFLOW)))
  assert.notEqual(second.seeds[WORKFLOW].sha, first.seeds[WORKFLOW].sha)
  // The config was left alone, so its entry must not have moved with it.
  assert.deepEqual(second.seeds[CONFIG], first.seeds[CONFIG])
})

test('init refuses to run outside a git repository, and writes nothing', () => {
  const dir = tmpDir()
  const { code, output } = run(SET, dir)
  assert.equal(code, 1)
  assert.match(output, /not a git repository/i)
  assert.ok(!existsSync(path.join(dir, MANIFEST_FILENAME)))
  assert.ok(!existsSync(path.join(dir, CONFIG)))
})

test('a missing value stops the run before anything is written', () => {
  // Every missing key at once, and the flag that supplies them. One key per failed run
  // is a conversation, not an error message.
  const root = tmpRepo()
  const { code, output } = run([], root)
  assert.equal(code, 1)
  assert.match(output, /nodeVersion/)
  assert.match(output, /lintCommand/)
  assert.match(output, /--set/)
  assert.ok(!existsSync(path.join(root, MANIFEST_FILENAME)))
  assert.ok(!existsSync(path.join(root, CONFIG)))
})

test('init rejects an argument it does not understand', () => {
  const root = tmpRepo()
  assert.equal(run(['--force'], root).code, 1)
  assert.equal(run(['--set', 'nodeVersion'], root).code, 1)
  assert.ok(!existsSync(path.join(root, CONFIG)))
})

test('a value given on the command line beats one found in the project', () => {
  const root = tmpRepo()
  writeFileSync(path.join(root, '.nvmrc'), '18\n')
  run([...SET, '--set', 'nodeVersion=22'], root)
  assert.ok(read(root, WORKFLOW).includes('"22"'))
})

test('init uses what it can detect, so a normal project needs no flags', () => {
  const root = tmpRepo()
  writeFileSync(path.join(root, '.nvmrc'), '20\n')
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ scripts: { lint: 'eslint .', test: 'node --test', build: 'tsc' } }),
  )

  assert.equal(run([], root).code, 0)
  const config = JSON.parse(read(root, CONFIG))
  assert.equal(config.defaultBranch, 'main')
  assert.equal(config.gates.lint, 'npm run lint')
  assert.equal(config.configVersion, CONFIG_VERSION)
})

test('init stops on a manifest it cannot read rather than replacing it', () => {
  // Rewriting it would backdate every seededBy it held to the version running now.
  const root = tmpRepo()
  writeFileSync(path.join(root, MANIFEST_FILENAME), '{ not json')
  const { code, output } = run(SET, root)
  assert.equal(code, 1)
  assert.match(output, /afk-manifest\.json/)
  assert.equal(read(root, MANIFEST_FILENAME), '{ not json')
})
