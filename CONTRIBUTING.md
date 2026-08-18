# Contributing

## Setup

```bash
git clone https://github.com/vToTheP/afk-factory.git
cd afk-factory
npm install
npm run check
```

| Command | What it does |
|---|---|
| `npm run check` | typecheck and tests — run this before pushing |
| `npm test` | tests only, on the built-in `node:test` runner |
| `npm run typecheck` | `tsc` against the JSDoc annotations |

Node ≥ 20 to develop, for the built-in test runner. The published package supports Node ≥ 18.

There is no build step. The package ships the source as it is written.

## How changes are reviewed

Work is tracked as issues. An issue labelled `status:ready` has no open blockers and can be
picked up; `status:blocked` means it is waiting on another issue, named in its body.

Keep pull requests small and focused on one issue. Explain in the description **why** the
change looks the way it does, not only what changed — the same standard applies to commit
messages. Every pull request is reviewed and merged by a human.

## Conventions

Coding conventions are in [AGENTS.md](AGENTS.md) — they apply to everyone, not only to
agents. The reasoning behind the decisions that shape the codebase is in
[docs/adr/](docs/adr/); read those before changing anything they cover, and add a new record
when you make a decision someone else would plausibly make differently.
