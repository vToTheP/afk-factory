# 1. File ownership and the update contract

- **Status:** accepted
- **Date:** 2026-08-18

## Context

The CLI writes files into a target project: workflow shells, a configuration file, agent
prompts. Those files then live in someone else's repository, where they are edited, moved,
and committed alongside everything else.

Once a newer version of the package ships, the files that were written are stale. Bringing
them up to date is the hard part. The obvious approach — diff and merge — is the wrong one
here for two reasons. There is no reliable `base` to merge against unless one is recorded
deliberately, and several of the files are prompts, where an automatic merge is not merely
risky but actively harmful: when an engine-owned instruction changes, a user's local
addition can start contradicting it, and a half-merged prompt is a broken agent that fails
in ways nobody can see by reading a diff.

The problem is therefore not "how do we merge these files" but "how do we avoid needing
to".

## Decision

**Every seeded file has exactly one owner, declared in the package.**

- `managed` — owned by the engine. Overwritten on update. Users customise these through the
  configuration file, never by editing the file itself.
- `seed-once` — owned by the user from the moment it is first written. Never modified
  automatically. This covers the configuration file and all agent prompts.

There is deliberately no third, shared class. Prompts are `seed-once`, and an updated
version is offered as a file alongside rather than merged in.

**A manifest records what was delivered.** `.afk-manifest.json`, committed, mapping each
seeded path to its ownership class, the hash of the content as delivered, and the version
that delivered it. Drift is then a three-way comparison between what we delivered (`base`),
what the currently installed package would deliver (`theirs`), and what is on disk
(`mine`).

Two rules make the hash meaningful. It is taken **after** template rendering, so a
parameterised file does not look permanently modified; and it **excludes** any marker
comment, whose version changes on every release and would otherwise make every file appear
to drift on every release.

`base` means *what the engine delivered* — nothing else may be written into that field. In
particular, when `init` encounters a file a user wrote by hand, it records the rendered seed
content as `base`, not the user's content. Recording the user's bytes would make the file
look untouched at the next comparison, and it would be overwritten as a "clean update"
without a conflict ever being raised.

**The tool reports drift; it never resolves it.** `update` produces a plan and writes
nothing by default. With `--apply` it writes only the unambiguous cases — files the user
never touched, and files that are new. Conflicts are left in place with the new version
written alongside, for a human to merge. Nothing is interactive, because the caller is
usually a scheduled job without a terminal; consent is expressed through flags.

## Consequences

Conflicts become the exception rather than the normal case, because a user who follows the
intended path never edits a `managed` file at all — that is what the configuration file is
for. This is what makes an update path viable without a merge engine.

The cost is borne by users who customise a `managed` file anyway. They get a conflict
instead of a merge, and have to reapply their change through configuration. That is
intended: the alternative is a tool that silently discards their work.

Recording a hash per file means the manifest must be written deterministically — sorted
keys, stable ordering — or it produces noise in every diff and becomes unreviewable.

Prompts will go stale in projects whose owners ignore update notices, since we will not
merge them automatically. Making the plan output readable, including as a Markdown document
that can be reviewed away from a terminal, is therefore part of the contract rather than a
convenience.

Reversing this decision later is expensive: manifests are committed in consumers'
repositories, so changing the meaning of a recorded field requires a migration rather than
a code change.
