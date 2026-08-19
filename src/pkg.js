/**
 * Package location and metadata.
 *
 * Every path in here is derived from `import.meta.url`, never from `process.cwd()`.
 * That distinction is the single most important one in this file: when the CLI is run
 * through `npx`, the package is installed into a cache directory somewhere outside the
 * target project (`~/.npm/_npx/<hash>/…`), while the current working directory is the
 * target project itself. Reading `seeds/` relative to the cwd therefore does not fail
 * loudly — it silently resolves to a path that happens not to exist, or worse, to an
 * unrelated directory in the user's project.
 *
 * If you are tempted to simplify this to a cwd-relative path because it works locally:
 * it works locally precisely because the package root and the cwd coincide there.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path to the installed package root. */
export const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * Locates the seeds directory of a package root.
 *
 * Exists so that the layout is written down once. A caller that needs to plan against a
 * package root other than the installed one — every test that builds a fixture package —
 * would otherwise repeat the directory name, and the copies would keep working right up
 * until the layout changed.
 *
 * @param {string} root Package root.
 * @returns {string} Absolute path to that package's seeds directory.
 */
export function seedsDirFor(root) {
  return path.join(root, 'seeds')
}

/** Absolute path to the shipped seed templates. */
export const SEEDS_DIR = seedsDirFor(PKG_ROOT)

/**
 * Reads the version of the installed package.
 *
 * Deliberately the package's own `package.json`, not the target project's — the two are
 * different files whenever the CLI runs against someone else's repository.
 *
 * @returns {string} The semver string declared by this package.
 */
export function packageVersion() {
  const raw = readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')
  return JSON.parse(raw).version
}

/**
 * Lists every file below `dir`, recursively.
 *
 * Returned paths are relative to `base`, use `/` as the separator on all platforms, and
 * are sorted. Both properties matter downstream: these paths are used as stable keys, so
 * a Windows backslash or a filesystem-dependent ordering would produce spurious
 * differences between machines.
 *
 * @param {string} dir Directory to walk.
 * @param {string} [base] Root the returned paths are relative to. Defaults to `dir`.
 * @returns {string[]} Sorted, `/`-separated relative file paths.
 */
export function listFiles(dir, base = dir) {
  /** @type {string[]} */
  const out = []
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry)
    if (statSync(abs).isDirectory()) out.push(...listFiles(abs, base))
    else out.push(path.relative(base, abs).split(path.sep).join('/'))
  }
  return out.sort()
}
