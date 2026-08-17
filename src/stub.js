/**
 * Placeholder for commands that are not built yet.
 *
 * Returns exit code 1 rather than 0 on purpose. A command that does nothing but reports
 * success is indistinguishable from one that worked, which is exactly the failure mode
 * the CLI is designed to avoid.
 *
 * @param {string} command Name of the command, used in the message.
 * @returns {() => number} A command function suitable for the dispatcher.
 */
export function notImplemented(command) {
  return () => {
    console.error(`afk-factory ${command}: not implemented yet.`)
    return 1
  }
}
