#!/usr/bin/env node
/**
 * Command dispatch.
 *
 * Fail-fast is the contract here: a verb's return value becomes the process exit code
 * unchanged, and a thrown error is logged *and* turned into a non-zero exit rather than
 * swallowed.
 *
 * This matters because the usual caller is an unattended scheduled job. A run that
 * degrades silently and still reports success is worse than one that fails outright —
 * a red run gets investigated, a green one does not, so a masked failure can go
 * unnoticed for weeks.
 *
 * Notifications are the deliberate exception to this rule. They are fire-and-forget and
 * must never influence the exit code; a chat webhook being unreachable is not a reason
 * to fail a build.
 */
import process from 'node:process'
import { packageVersion } from '../src/pkg.js'

const VERBS = ['run', 'init', 'doctor', 'update']

const USAGE = `afk-factory <command> [options]

  run      execute one slice (gates, issue selection, pull request)
  init     unpack seeds into the target project and write its config
  doctor   pre-flight check of the setup
  update   bring seeded files up to the packaged version (plan only by default)

  --version   print the package version
  --help      print this help

Exit codes: 0 = ok · 1 = error · 2 = action required (e.g. drift)`

const [verb, ...rest] = process.argv.slice(2)

if (verb === '--version' || verb === '-v') {
  console.log(packageVersion())
  process.exit(0)
}

if (!verb || verb === '--help' || verb === '-h') {
  console.log(USAGE)
  // An invocation without a command is incomplete, not successful.
  process.exit(verb ? 0 : 2)
}

if (!VERBS.includes(verb)) {
  console.error(`unknown command "${verb}" — expected one of: ${VERBS.join(' | ')}`)
  console.error(`\n${USAGE}`)
  process.exit(2)
}

try {
  // `.href` rather than the URL object: dynamic import is specified to take a string,
  // and passing the object works only by grace of the Node implementation.
  const mod = await import(new URL(`../src/${verb}.js`, import.meta.url).href)
  process.exitCode = await mod.default(rest)
} catch (err) {
  console.error(`afk-factory ${verb} failed:`)
  console.error(err instanceof Error ? err.stack : String(err))
  process.exitCode = 1
}
