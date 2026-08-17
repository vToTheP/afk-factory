# afk-factory

A stack-agnostic CLI that runs an **issue-driven, agent-based development loop** on GitHub
Issues: pick an issue, implement one slice, run the project's gates, open a pull request.

> **Status: early development.** Nothing is published to npm yet and every command is a stub.
> The build plan lives in the [issues](https://github.com/vToTheP/afk-factory/issues).

## How much autonomy

A human merges every pull request, by design. The factory picks up an issue, implements one
slice, runs the project's gates and opens a pull request — and stops there. Changes that
continuous integration cannot catch, or that are hard to reverse once shipped, are routed to
a human review tier explicitly rather than by accident.

This is deliberately not a fully autonomous pipeline that ships to production without
oversight. The value on offer is unattended *work*, not unattended *judgement*: you get a
stack of reviewable pull requests in the morning, and the merge button stays yours.

## Idea

Everything deterministic belongs in the CLI, not in a prompt. Gate execution, issue
selection and git plumbing are code; the agent prompts keep only the parts that require
judgement. The target project declares its own gates (`lint`, `test`, `build`, whatever it
calls them) in `.afk-factory.json`, so the factory needs to know nothing about the stack.

## Commands

| Command | Purpose |
|---|---|
| `run` | execute one slice |
| `init` | unpack seeds into the target project and write its config |
| `doctor` | pre-flight check of the setup |
| `update` | bring seeded files up to the packaged version (plan only by default) |

Exit codes: `0` = ok · `1` = error · `2` = action required, such as drift.

## Two invariants

**Fail fast when orchestrating.** If a push or a gate fails, the CLI exits non-zero, and the
workflow shell that invokes it must not mask that. The usual caller is an unattended
scheduled job, where a run that degrades silently and still reports success is worse than
one that fails outright: nobody investigates green.

**Fire and forget when notifying.** Calls to anything other than GitHub and the npm registry
— chat webhooks, push notifications — run with a hard timeout and may only log on failure.
An unreachable notification endpoint is not a reason to fail a build.

## Development

```bash
npm run check      # typecheck + tests
npm test           # node:test
npm run typecheck  # tsc against the JSDoc annotations
```

The package ships with **no runtime dependencies**. For a CLI that is executed through
`npx` inside other people's projects, every dependency is both install latency and attack
surface. Types are expressed as JSDoc and verified with `tsc --checkJs`, which buys most of
the safety of TypeScript without a build step and without shipping anything extra —
`typescript` and `@types/node` are development dependencies only.

Node ≥ 18 to use, Node ≥ 20 to develop (for the built-in test runner).

## Bootstrapping

This repository deliberately has **no CI and no factory workflows**, and they will not be
added by hand. Once `init` works, the factory sets this repository up using its own wizard —
the first real test of the setup path is the project setting itself up. Until then the
engine is built interactively.

## License

MIT
