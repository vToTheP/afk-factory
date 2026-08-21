/**
 * The few things this tool asks Git about the project it is running in.
 *
 * Every call goes through `gitOutput`, which returns `null` instead of throwing. Git is
 * an external process with three ways to disappoint — not installed, not a repository,
 * something unexpected on stderr — and a raw `ExecFileSyncException` reaching a CI log
 * says `Command failed: git rev-parse` and nothing an operator can act on. Each caller
 * turns `null` into the answer that fits it: a sentence for the root, which is required,
 * and absence for the branch, which is a convenience.
 *
 * `execFileSync` rather than `execSync`: no shell means no quoting rules to get wrong,
 * and nothing here needs a shell. It also keeps a path with a space in it from becoming
 * two arguments, which on Windows is the normal case rather than the exotic one.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { UserError } from './errors.js'

/**
 * Runs git and returns its trimmed stdout, or `null` if it did not produce any.
 *
 * @param {string[]} args
 * @param {string} cwd Directory to run in.
 * @returns {string | null}
 */
function gitOutput(args, cwd) {
  try {
    const out = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const trimmed = out.trim()
    return trimmed === '' ? null : trimmed
  } catch {
    return null
  }
}

/**
 * Finds the root of the repository a directory belongs to.
 *
 * Required rather than convenient, which is why this one throws. A seeded workflow is
 * only a workflow at the root of the repository: `.github/workflows` anywhere else is a
 * directory GitHub never reads. Seeding relative to the working directory would
 * therefore succeed, report success, and produce nothing that runs — in a monorepo, the
 * likeliest place for somebody to type the command.
 *
 * @param {string} [cwd] Directory to resolve from. Defaults to the working directory.
 * @returns {string} Absolute path to the repository root.
 * @throws {UserError} If git is unavailable or the directory is not in a repository.
 */
export function repoRoot(cwd = process.cwd()) {
  const root = gitOutput(['rev-parse', '--show-toplevel'], cwd)
  if (root === null) {
    throw new UserError(
      `Not a git repository (or git is not installed): ${cwd}\n` +
        'afk-factory seeds files at the root of a repository. Run it inside one.',
    )
  }
  // git answers with forward slashes on every platform, including Windows, where the
  // result is then joined onto paths built by node:path.
  return path.resolve(root)
}

/**
 * Reports the branch currently checked out.
 *
 * A convenience, so it reports absence rather than failing: a detached HEAD and a
 * repository without commits are both ordinary states, and neither is a reason to stop.
 *
 * @param {string} [cwd] Directory to resolve from.
 * @returns {string | undefined} The branch name, if there is one.
 */
export function currentBranch(cwd = process.cwd()) {
  return gitOutput(['branch', '--show-current'], cwd) ?? undefined
}

/**
 * Reports the branch the remote considers its default.
 *
 * Preferred over the checked-out branch when both are known: the workflow this value
 * ends up in triggers on pushes to the project's main line of development, which is not
 * necessarily the branch somebody happened to be on while running `init`.
 *
 * @param {string} [cwd] Directory to resolve from.
 * @returns {string | undefined} The branch name, if a remote declares one.
 */
export function remoteDefaultBranch(cwd = process.cwd()) {
  const ref = gitOutput(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd)
  if (ref === null) return undefined
  const slash = ref.indexOf('/')
  return slash === -1 ? ref : ref.slice(slash + 1)
}
