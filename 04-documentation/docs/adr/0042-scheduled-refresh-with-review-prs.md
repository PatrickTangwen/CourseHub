# Scheduled Refresh With Review PRs

Status: accepted. Implements the scheduling slice deferred by ADR 0041.

## Decision

A launchd user agent (`com.sungrid.coursetable-etl`, Monday and Thursday
07:00 local) runs `tools/etl/run-scheduled-refresh.mts`, which executes the
one-command ETL refresh inside a dedicated git worktree and, only when the
refresh report shows a material change, commits the published artifacts to a
`data-refresh/<date>` branch, pushes that branch, and opens a review PR whose
body is the refresh report. Merging the PR, dispatching the Cloudflare
deployments, and Staging acceptance remain human decisions.

Key mechanics:

- **Worktree isolation.** The run never touches the operator's working copy.
  The worktree (`~/.coursetable-etl/worktree`) is reset to `origin/main` on
  every run, so the automation always executes the merged pipeline code.
- **Shared data archive.** The worktree's gitignored `data/` is a symlink to
  the main clone's `data/`, keeping raw runs, normalized history, and reports
  in one durable place (the same state the metadata consolidation needs).
- **Material-change gate.** Snapshot headers churn on every run
  (`generated_at`, run ids), so the PR gate is the report's course-level
  digest evidence, not the git diff. No material change means no PR.
- **Fail fast, fail loudly.** A report/diff mismatch, tracked changes outside
  the artifact paths, or any failed step aborts the run before pushing; the
  outcome (PR URL, quiet run, or failure) is posted as a macOS notification
  and captured in the repository's gitignored `data/logs/`.
- **A pid-checked lock** prevents overlapping runs; a crashed run's stale
  lock is reclaimed.

## Why

With acquisition, validation, and reporting already one command (ADR 0041),
the remaining recurring labor was invoking it, writing the data commit, and
opening the review. Scheduling those preserves the existing review and
deployment gates while reducing the operator's role to judgment: review the
PR, merge, deploy, accept.

Local launchd was chosen over hosted scheduling because the durable
`data/raw` and `data/normalized` archives live only on this machine.
Cloudflare Workers Cron + Workflows remains the hosted alternative once that
state is archived to R2.

## Consequences

- The automation runs merged code from `origin/main`; pipeline changes take
  effect on the schedule only after they are pushed.
- The branch push and PR creation use the operator's own git/`gh`
  credentials; the base branch is never pushed.
- Reinstall after moving the repository or bun:
  `bun tools/etl/install-launchd.mts` (paths are pinned absolute).
- Operations notes live in `docs/etl_refresh.md`.
