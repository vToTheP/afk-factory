# 2. Orchestration fails loudly, notification fails quietly

- **Status:** accepted
- **Date:** 2026-08-18

## Context

The CLI runs unattended. Its usual caller is a scheduled job, and the only thing anyone
looks at afterwards is whether the run was green or red. That signal is the entire basis on
which the tool can be trusted, and it is fragile in two opposite ways.

If failures are swallowed, a run can push nothing, open nothing, and still report success.
Nobody investigates a green run, so the failure survives until someone happens to notice the
absent pull requests — which can take weeks. This is not hypothetical: a run that could not
push because a token lacked permissions reported success, and the mistake was only found by
reading the log of a run nobody had reason to read.

If, on the other hand, every failure is fatal, then an unreachable notification endpoint
turns a run red. Notification endpoints are exactly the kind of thing that is intermittently
unreachable — restrictive network policies, expired topics, a service having a bad day. Red
runs that do not mean anything are worse than no signal at all, because people learn to
ignore the colour.

Both failure modes end in the same place: the traffic light stops meaning anything.

## Decision

The rule is asymmetric, and the asymmetry is the point.

**Orchestration fails loudly.** Anything that constitutes the work — running a gate, pushing
a branch, opening a pull request, moving an issue — exits non-zero on failure and lets the
status propagate. The command dispatcher turns a command's return value into the process
exit code unchanged and does not swallow exceptions.

This extends past the process boundary. A workflow shell that invokes the CLI must not mask
the status: no `|| true`, no `continue-on-error`, no pipe without `pipefail`. An exit code
nobody acts on is the same as no exit code, which is why the workflow shell the tool ships
is engine-owned rather than something users are invited to edit.

**Notification fails quietly.** Calls to anything other than GitHub and the npm registry —
chat webhooks, push notifications — run with a hard timeout, log on failure, and never touch
the exit code. A missed notification is acceptable; a hung or failed run because a webhook
was unreachable is not.

## Consequences

A green run means the work happened. That is the property everything else depends on, and it
is worth the cost of the two rules being different.

The cost is that the codebase contains what looks like an inconsistency: one call site exits
non-zero on error, a structurally similar one logs and continues. Anyone tidying up in good
faith will be tempted to make them uniform, in either direction, and both directions are
wrong. This record exists mainly so that the temptation meets an argument.

Notifications are best-effort by construction. There is no retry and no delivery guarantee,
so they must never be the only channel through which something important is communicated —
whatever a notification says must also be recoverable from the run's own output.

Adding an outbound call means deciding which side of the line it falls on. The test is
whether the run did its job without it: if yes, it is notification.
