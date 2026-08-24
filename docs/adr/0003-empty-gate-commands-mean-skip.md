# 3. Empty gate commands mean skip

- **Status:** accepted
- **Date:** 2026-08-24

## Context

A project declares its own gates in `.afk-factory.json` — what `lint`, `test` and `build`
mean in its stack — and the factory runs them without knowing anything about the stack
itself. The set of gate names is fixed by the configuration seed.

Not every project has all of them. This repository is the first example and found the
problem immediately: a zero-dependency package with no build step, checked by `tsc
--checkJs` rather than by a linter. There is no build command to write down, and there is
no honest lint command either — `npm run typecheck` is the gate that plays that role.

So a value has to be written for something the project does not have. Three options were
available, and the choice is not obvious.

**Invent a command.** Rejected outright. A value invented here is written into a committed
workflow in somebody else's repository, and the first sign of a wrong one is a red run in
a project that has just been set up — the moment a person is least able to tell a broken
tool from a broken setup.

**Omit the key.** This is the option that looks cleanest and is in fact the trap. The
configuration file is `seed-once` (ADR 0001): it belongs to the user from the moment it is
first written and is never modified automatically. Its shape is therefore frozen at seed
time. A key that is absent today cannot be added by a later release, so the meaning of
"absent" would have to be inferred forever, and the inference would have to be identical
in every command that ever reads a gate. Worse, absence is indistinguishable from a key
somebody deleted by accident while editing the file by hand — which is the expected way to
edit it.

**Write an empty string.** The absence becomes something the file states rather than
something a reader deduces.

## Decision

**An empty gate command means: this gate does not exist for this project. Skip it.**

It is a valid, expected configuration value. It is not a configuration error, not a
placeholder, and not "not configured yet".

This binds every command that reads a gate, and `run` in particular, which is the one that
executes them:

- A gate with an empty command is reported as skipped and contributes nothing to the
  result. It does not fail the run.
- No shell command is executed for it. `sh -c ""` succeeds silently, which would make a
  skipped gate indistinguishable from a passing one in the log — the reader of that log
  is deciding whether to trust a pull request.
- It is not a reason to reject the configuration or to abort.

`init` writes an empty string for any gate it can neither detect nor be given, rather than
refusing to seed a project that does not have all three.

## Consequences

The contract has to be honoured by code that does not exist yet, which is the reason this
record exists at all rather than a comment next to the value. This repository's own
`.afk-factory.json` already carries `"build": ""`, committed, so the first project to
break if `run` mishandles it is this one.

The distinction between "skip" and "fail" is now carried by a value rather than by a
schema, and nothing enforces it structurally. A test in the slice that executes gates has
to hold it: an empty gate is skipped, and the run stays green.

Meaningful whitespace is a hazard the decision creates. `" "` is not empty and would be
executed. Whoever implements gate execution should trim before deciding, so that a value
edited by hand behaves the way it looks.

A project that acquires a build step later edits its own configuration file to add the
command. That is the intended path — the file is theirs — and it is why the empty value
does not need to be updatable by the engine.
