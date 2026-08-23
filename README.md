# afk-factory

A stack-agnostic CLI that runs an **issue-driven, agent-based development loop** on GitHub
Issues: pick an issue, implement one slice, run the project's gates, open a pull request.

> **Status: early development.** Nothing is published to npm yet. `init` works; `run`,
> `doctor` and `update` are still stubs that exit non-zero. Progress lives in the
> [issues](https://github.com/vToTheP/afk-factory/issues).

## How much autonomy

A human merges every pull request, by design. The factory picks up an issue, implements one
slice, runs the project's gates and opens a pull request — and stops there. Changes that
continuous integration cannot catch, or that are hard to reverse once shipped, are routed to
a human review tier explicitly rather than by accident.

This is deliberately not a fully autonomous pipeline that ships to production without
oversight. The value on offer is unattended *work*, not unattended *judgement*: you get a
stack of reviewable pull requests in the morning, and the merge button stays yours.

## Requirements

- Node.js ≥ 18
- A GitHub repository whose issues you want worked on

## Installation

None. The CLI is meant to be run through `npx`, so a project never takes a dependency on it:

```bash
npx afk-factory init
```

## Getting started

`init` reads what it can from your repository, writes a configuration file and unpacks the
files the factory needs. `doctor` then verifies the result:

```bash
npx afk-factory init     # set up this repository
npx afk-factory doctor   # check the setup
npx afk-factory run      # work one issue and open a pull request
```

`init` is additive: it never overwrites a file that is already there, whatever that file
is. Anything it finds in place is reported as skipped and left alone, and bringing an
existing file up to a newer version is `update`'s job, where you get a plan to read first.

It also writes `.afk-manifest.json`, which records what was delivered and with which
version. **Commit it.** On a fresh clone or in CI it is the only record of what the files
looked like when they were written, and without it `update` cannot tell a change you made
from a change we shipped. The file is machine-generated; edit the configuration instead.

Values `init` cannot work out for itself are supplied with `--set key=value`, and it names
the ones it is missing rather than inventing them. That flag is scaffolding for the
interactive setup that will replace it, so do not build anything on it.

Your project declares its own gates — whatever `lint`, `test` or `build` mean in your
stack — in `.afk-factory.json`. The factory runs them and does not need to know anything
about the stack itself.

## Commands

| Command | Purpose |
|---|---|
| `run` | work one issue and open a pull request |
| `init` | unpack the factory's files into the project and write its config |
| `doctor` | pre-flight check of the setup |
| `update` | bring those files up to the installed version (plan only by default) |

Exit codes: `0` = ok · `1` = error · `2` = action required, such as configuration drift.

## No runtime dependencies

The package installs nothing beyond itself. For a CLI executed through `npx` inside your
project, every transitive dependency would be both install latency and supply-chain surface.

## Contributing

Conventions, local setup and how changes are reviewed are described in
[CONTRIBUTING.md](CONTRIBUTING.md). The reasoning behind the load-bearing design decisions
is recorded in [docs/adr/](docs/adr/).

## License

MIT
