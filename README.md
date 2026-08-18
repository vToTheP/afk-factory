# afk-factory

A stack-agnostic CLI that runs an **issue-driven, agent-based development loop** on GitHub
Issues: pick an issue, implement one slice, run the project's gates, open a pull request.

> **Status: early development.** Nothing is published to npm yet and every command is a stub.
> The commands below describe the intended interface, not something you can run today.
> Progress lives in the [issues](https://github.com/vToTheP/afk-factory/issues).

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

`init` asks about your project, writes a configuration file and unpacks the files the
factory needs into your repository. `doctor` then verifies the result:

```bash
npx afk-factory init     # set up this repository
npx afk-factory doctor   # check the setup
npx afk-factory run      # work one issue and open a pull request
```

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
