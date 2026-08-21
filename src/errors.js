/**
 * The error a command reports as a sentence rather than as a stack.
 *
 * The distinction is between something the operator has to act on — no repository, a
 * value nobody supplied, a manifest that cannot be read — and a defect in this tool. The
 * first is answered by one line saying what to do; a stack trace above it buries that
 * line, and the usual reader is scrolling a CI log.
 *
 * Anything that is not a UserError keeps its stack and reaches the dispatcher, because
 * for a defect the stack is the only useful part.
 */
export class UserError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'UserError'
  }
}
