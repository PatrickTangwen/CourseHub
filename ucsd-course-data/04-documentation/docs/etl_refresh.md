# ETL Refresh Runbook

Date: 2026-08-05

Status: operations notes for the one-command ETL refresh orchestrator
(ADR 0041). Source behaviors and parser rules stay in `snapshot_pipe.md`.

## One-Command Refresh

```bash
bun run etl:refresh
```

This runs, in order:

1. **Discovery.** Probes the live Schedule of Classes Term Window and the
   Class Planner term registry (`/api/v1/planner/terms`). A term served by
   both sources aborts the refresh before anything is mutated; decide the
   schedule source for that term first (ADR 0040).
2. **Before-state capture.** Copies `api/static/catalogs/public/` into
   `data/reports/etl/<timestamp>/before/` for the refresh report.
3. **Schedule of Classes refresh.** The multi-term pipeline fetches SoC per
   term/subject plus General Catalog and Instructor Grade Archive per
   subject, publishes snapshots, Import Manifests, `metadata.json`, and
   fresh normalized runs under `data/normalized/`.
4. **Class Planner refresh.** For each planner term with data (currently
   FA26): fetch raw pages into `data/raw/classplanner/<TERM>/<timestamp>/`,
   convert to `tss-chatbot-v1`, and publish the TSS snapshot. Running after
   step 3 keeps the term's registry entry active instead of frozen. The
   primary metadata directory is auto-selected as the newest normalized
   multi-run for the Active Planning Term; consolidation across preserved
   runs still happens through the metadata root.
5. **Supported terms.** Rewrites
   `frontend/src/generated/supported-terms.json` from the final registry.
6. **Validators.** `validate:staging-deployment` and
   `validate:production-deployment` (credential-free; structural
   publishability only, not a hosted deployment).
7. **Refresh report.** Diffs before/after published JSON with embedded
   DuckDB (byte-level course digests, so a reported change is a real change)
   and writes `data/reports/etl/<timestamp>/refresh-report.{json,md}`. The
   Markdown table is the intended source for the data commit message.

The run fails fast on any step; nothing falls back silently. Raw pages are
preserved before conversion, so failed runs replay offline.

## What Stays Manual By Design

Reviewing the refresh report, committing the regenerated JSON, merging,
dispatching the Cloudflare staging/production deployments, and Staging
acceptance. See ADR 0041.

## Telemetry

Spans cover discovery, each pipeline, each Class Planner term, validators,
and the report. Export is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://<collector>/v1/traces bun run etl:refresh
```

## Individual Steps

The underlying CLIs remain runnable on their own; see `snapshot_pipe.md`
(Class Planner Catalog Source) for the three-command Class Planner sequence
and the TSS publisher flags.

## Scheduled Runs (ADR 0042)

A launchd agent (`com.sungrid.coursetable-etl`, Monday and Thursday 07:00
local) runs `tools/etl/run-scheduled-refresh.mts`:

1. Resets the dedicated worktree `~/.coursetable-etl/worktree` to
   `origin/main` (the operator's working copy is never touched; the
   worktree's `data/` symlinks to the main clone's durable archive).
2. Installs dependencies and runs `etl:refresh` there.
3. If the refresh report shows no material change (header timestamps alone
   do not count), it exits quietly with a notification and no PR.
4. Otherwise it commits `api/static/catalogs`, `api/static/metadata.json`,
   and `frontend/src/generated/supported-terms.json` to a
   `data-refresh/<date>` branch, pushes that branch (never `main`), and
   opens a review PR with the refresh report as its body.

Because the worktree checks out `origin/main`, the schedule runs merged
pipeline code only: pushing pipeline changes to `main` is what deploys them
to the automation.

Operations:

```bash
bun tools/etl/run-scheduled-refresh.mts   # manual run of the same flow
bun tools/etl/install-launchd.mts         # (re)install the agent
bun tools/etl/install-launchd.mts --uninstall
launchctl kickstart gui/$(id -u)/com.sungrid.coursetable-etl  # run now
```

Logs: `data/logs/refresh.log` and `data/logs/refresh.err.log` in the main
clone (gitignored with the rest of `data/`). Outcomes (PR URL, quiet run,
failure) also arrive as macOS notifications.

After a PR opens, the remaining flow is unchanged and deliberately manual:
review the report in the PR, merge, dispatch `cloudflare-staging-deploy`,
accept Staging, dispatch `cloudflare-production-deploy`.

The hosted alternative (Cloudflare Workers Cron + Workflows) stays deferred
until `data/raw` and `data/normalized` are archived to R2; without that
state a hosted runner cannot consolidate historical normalized metadata.

## Post-Merge Protected Rollout (2026-08-10, ADR 0043)

This section supersedes the earlier statement that deployment dispatch remains
manual. Review and merge of the Monday/Thursday `data-refresh/*` PR remain
manual. After merge, `.github/workflows/scheduled-data-refresh-rollout.yml`
waits for the resulting `main` CI run to succeed, proves that the commit came
from a merged scheduled-refresh PR, and then enters the existing protected
Staging-to-Production sequence.

The Staging and Production GitHub Environments keep their required-reviewer
gates. Staging must be approved, deployed, smoked, and accepted before the same
commit can queue for Production approval. Production deploys with public login
disabled; the separate login-toggle approval path is unchanged. Failed CI,
non-refresh commits, failed Staging, and unapproved environments do not advance.

Implementation correction, 2026-08-10: both reusable deployment calls include
`secrets: inherit`. This is required for the called workflow's secret context;
the Staging and Production Environment approvals remain the access gates.
