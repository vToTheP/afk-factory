import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONFIG_FILENAME, CONFIG_VERSION } from '../src/config.js'
import { buildSeedPlan, requiredValues } from '../src/seeds/plan.js'

/** Values chosen only to make the packaged templates render. */
const VALUES = Object.fromEntries(requiredValues().map((key) => [key, 'x']))

test('the configuration seed declares the schema version the code believes in', () => {
  // The number lives twice: as a literal in the template, because the renderer's
  // contract puts placeholders inside double quotes and this field is a number, and as
  // CONFIG_VERSION, because the manifest records it. This is the test that keeps the two
  // copies honest — without it, a bump would be applied to one of them and the manifest
  // would describe a config shape that was never written.
  const plan = buildSeedPlan({ config: VALUES })
  const seed = plan.find((entry) => entry.target === CONFIG_FILENAME)
  assert.ok(seed, `no seed for ${CONFIG_FILENAME}`)
  assert.equal(JSON.parse(seed.rendered).configVersion, CONFIG_VERSION)
})

test('requiredValues names every value the packaged seeds need', () => {
  const keys = requiredValues()
  assert.deepEqual([...new Set(keys)], keys, 'keys should be deduplicated')
  for (const key of ['defaultBranch', 'nodeVersion', 'engineVersion', 'lintCommand', 'testCommand', 'buildCommand']) {
    assert.ok(keys.includes(key), `missing ${key}`)
  }
})
