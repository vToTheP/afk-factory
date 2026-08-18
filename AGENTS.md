# Working on this repository

Conventions for anyone — human or agent — changing code here. User-facing documentation is
in [README.md](README.md); the reasoning behind decisions is in [docs/adr/](docs/adr/).

## Before you push

```bash
npm run check   # typecheck + tests, both must pass
```

## Language and scope

Everything in this repository is written in **English**: code, comments, commit messages,
issue and pull request text.

**No references to other repositories or to private planning history.** This project stands
on its own. If a decision needs justifying, justify it here, in full — a reader should never
have to look elsewhere to understand why the code is the way it is. Issue references are
fine when they point at issues in this repository.

## Dependencies

**No runtime dependencies, ever.** This CLI runs through `npx` inside other people's
projects, where every transitive dependency is install latency and supply-chain surface.

Development dependencies for quality tooling are fine. Types are written as JSDoc and
verified with `tsc --checkJs` (`npm run typecheck`), which gives most of the safety of
TypeScript with no build step and nothing extra shipped.

## Two invariants that pull in opposite directions

**Orchestration fails loudly.** If a push, a gate or an issue transition fails, exit
non-zero and let it propagate. Never wrap the CLI in something that masks the status.

**Notification fails quietly.** Calls to anything other than GitHub and the npm registry run
with a hard timeout and may only log on failure. They must never influence the exit code.

The asymmetry is deliberate and easy to mistake for an inconsistency worth tidying up — read
[ADR 0002](docs/adr/0002-orchestration-fails-loudly-notification-fails-quietly.md) before
changing either side.

## Seeded files

Files the CLI writes into a target project have exactly one owner each, and the tool reports
drift rather than resolving it. This shapes most of what `init`, `update` and `doctor` do —
see [ADR 0001](docs/adr/0001-file-ownership-and-the-update-contract.md).

## Bootstrapping

This repository has no CI and no factory workflows yet, and they should not be written by
hand: once `init` works, the repository is set up by running the tool on itself. Hand-writing
them now would create a second copy of every template — and it would be the hand-written copy
that gets maintained, because it is the one that runs.

## Comments and documentation

Comments explain **why**, not what. If a comment paraphrases the code, either the comment is
redundant or the code needs a better name.

JSDoc goes on exported functions, which are the contract. Internal helpers get it only when
something is genuinely surprising.

Commit messages carry the history — what led to a change, what was ruled out. That is where
context belongs, not in the code.
