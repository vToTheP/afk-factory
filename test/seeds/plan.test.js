import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { CATALOG_FILENAME, TEMPLATES_DIRNAME } from '../../src/seeds/catalog.js'
import { MARKER_TAG, contentSha } from '../../src/seeds/marker.js'
import { buildSeedPlan } from '../../src/seeds/plan.js'

/**
 * Builds a package root with a catalog and its templates.
 *
 * A fixture package rather than the real one, so these tests keep asserting on the
 * planner's behaviour when a seed is added or a template is reworded.
 *
 * @param {{ seeds: Record<string, unknown>[], templates: Record<string, string> }} spec
 * @returns {string} Absolute path to the fixture package root.
 */
function fixturePkg(spec) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'afk-plan-'))
  test.after(() => rmSync(root, { recursive: true, force: true }))
  const seedsDir = path.join(root, 'seeds')
  mkdirSync(seedsDir, { recursive: true })
  writeFileSync(path.join(seedsDir, CATALOG_FILENAME), JSON.stringify({ seeds: spec.seeds }))
  for (const [rel, content] of Object.entries(spec.templates)) {
    const abs = path.join(seedsDir, TEMPLATES_DIRNAME, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

const MANAGED = {
  seeds: [{ source: 'run.yml.tmpl', target: '.github/workflows/run.yml', class: 'managed', marker: 'hash' }],
  templates: { 'run.yml.tmpl': 'branch: "{{afk:defaultBranch}}"\n' },
}

const SEED_ONCE = {
  seeds: [{ source: 'config.json.tmpl', target: '.afk-factory.json', class: 'seed-once', marker: 'none' }],
  templates: { 'config.json.tmpl': '{ "branch": "{{afk:defaultBranch}}" }\n' },
}

test('buildSeedPlan plans one entry per seed, sorted by target, carrying its class', () => {
  const pkgRoot = fixturePkg({
    seeds: [...MANAGED.seeds, ...SEED_ONCE.seeds],
    templates: { ...MANAGED.templates, ...SEED_ONCE.templates },
  })
  const plan = buildSeedPlan({ pkgRoot, config: { defaultBranch: 'main' } })
  assert.deepEqual(
    plan.map((p) => [p.target, p.class]),
    [
      ['.afk-factory.json', 'seed-once'],
      ['.github/workflows/run.yml', 'managed'],
    ],
  )
})

test('the sha is taken over the rendered content before the marker is stamped', () => {
  // The order is not interchangeable: the marker carries the sha, so hashing the stamped
  // content would be hashing something that does not exist yet. contentSha strips the
  // marker and would agree either way — which is exactly why the wrong order would go
  // unnoticed here and only surface once a marker format changes.
  const pkgRoot = fixturePkg(MANAGED)
  const [entry] = buildSeedPlan({ pkgRoot, config: { defaultBranch: 'main' } })
  assert.equal(entry?.sha, contentSha('branch: "main"\n'))
  assert.equal(entry?.rendered, `# ${MARKER_TAG}: ${entry?.sha}\nbranch: "main"\n`)
})

test('the sha of a planned seed is the sha of its own rendered content', () => {
  // The property init relies on: what goes into the manifest describes what was written.
  const pkgRoot = fixturePkg(MANAGED)
  for (const entry of buildSeedPlan({ pkgRoot, config: { defaultBranch: 'main' } })) {
    assert.equal(contentSha(entry.rendered), entry.sha)
  }
})

test('a seed whose format carries no comment is planned unstamped', () => {
  const pkgRoot = fixturePkg(SEED_ONCE)
  const [entry] = buildSeedPlan({ pkgRoot, config: { defaultBranch: 'main' } })
  assert.equal(entry?.rendered, '{ "branch": "main" }\n')
  assert.ok(!entry?.rendered.includes(MARKER_TAG))
})

test('the plan is the same whatever the target project looks like, and writes nothing', () => {
  // buildSeedPlan describes the desired state. Reading the project here would put the
  // comparison against the actual state in two places once update exists, and the two
  // would answer differently the first time one of them was changed.
  const pkgRoot = fixturePkg(MANAGED)
  const config = { defaultBranch: 'main' }
  const planned = buildSeedPlan({ pkgRoot, config })

  const project = mkdtempSync(path.join(os.tmpdir(), 'afk-project-'))
  const cwd = process.cwd()
  test.after(() => {
    process.chdir(cwd)
    rmSync(project, { recursive: true, force: true })
  })
  mkdirSync(path.join(project, '.github', 'workflows'), { recursive: true })
  writeFileSync(path.join(project, '.github', 'workflows', 'run.yml'), 'hand written\n')
  process.chdir(project)

  assert.deepEqual(buildSeedPlan({ pkgRoot, config }), planned)
  assert.deepEqual(readdirSync(project), ['.github'])
  assert.equal(readdirSync(path.join(project, '.github', 'workflows')).length, 1)
})

test('a missing value fails the plan rather than reaching a file', () => {
  const pkgRoot = fixturePkg(MANAGED)
  assert.throws(() => buildSeedPlan({ pkgRoot, config: {} }), /missing template value: defaultBranch/)
})

test('an invalid catalog fails the plan', () => {
  const pkgRoot = fixturePkg({
    seeds: [{ source: 'run.yml.tmpl', target: '.github/workflows/run.yml', class: 'managed', marker: 'none' }],
    templates: MANAGED.templates,
  })
  assert.throws(() => buildSeedPlan({ pkgRoot, config: { defaultBranch: 'main' } }), /marker type/)
})

test('the packaged seeds plan into the files this package promises', () => {
  // The one test that runs against the real catalog: a template that stops rendering is
  // a shipped defect, and nothing else in the suite would notice.
  const plan = buildSeedPlan({
    config: {
      defaultBranch: 'main',
      nodeVersion: '20',
      engineVersion: '1.2.3',
      lintCommand: 'npm run lint',
      testCommand: "npm test -- --grep 'slow'",
      buildCommand: 'npm run build',
    },
  })
  const byTarget = new Map(plan.map((p) => [p.target, p]))
  assert.deepEqual([...byTarget.keys()], ['.afk-factory.json', '.github/workflows/afk-run.yml'])

  const config = byTarget.get('.afk-factory.json')
  assert.equal(config?.class, 'seed-once')
  assert.deepEqual(JSON.parse(config?.rendered ?? '').gates.test, "npm test -- --grep 'slow'")

  const workflow = byTarget.get('.github/workflows/afk-run.yml')
  assert.equal(workflow?.class, 'managed')
  assert.ok(workflow?.rendered.startsWith(`# ${MARKER_TAG}: ${workflow?.sha}\n`))
  assert.ok(workflow?.rendered.includes('${{ secrets.GITHUB_TOKEN }}'))
})
