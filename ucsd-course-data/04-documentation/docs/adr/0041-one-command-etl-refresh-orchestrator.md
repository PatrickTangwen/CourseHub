# One-Command ETL Refresh Orchestrator

Status: accepted. Builds on ADR 0012 (multi-term pipeline), ADR 0036-0038
(TSS snapshot semantics), and ADR 0040 (Class Planner schedule source).

## Decision

A single orchestrator (`bun run etl:refresh`, `tools/etl/runRefresh.ts`)
encodes the full data-refresh sequence that was previously run by hand:

1. Discover the live Schedule of Classes Term Window and the Class Planner
   term registry, and fail on any term served by both sources before anything
   is mutated.
2. Preserve the published-catalog before-state.
3. Run the multi-term Schedule of Classes pipeline.
4. For each Class-Planner term: fetch, convert to `tss-chatbot-v1`, and
   publish the TSS snapshot. This ordering keeps the term's registry entry
   active rather than frozen after the Schedule of Classes registry rewrite.
5. Rewrite the generated supported-terms list from the final registry.
6. Run the credential-free deployment validators.
7. Diff before/after published JSON into a refresh report
   (`data/reports/etl/<timestamp>/`), computed with embedded DuckDB over the
   raw course JSON text, with Import Manifest summaries attached as evidence.

The orchestrator is instrumented with OpenTelemetry spans through the
no-op-by-default API; an OTLP exporter registers only when
`OTEL_EXPORTER_OTLP_ENDPOINT` is set.

## Why

Manual refreshes required plumbing run-directory timestamps between three
Class Planner commands, hand-selecting the normalized metadata run, and
remembering the SoC-before-Class-Planner ordering constraint that otherwise
freezes the future term. Encoding the sequence removes those failure modes
and produces the truthful per-term delta summary that data commits need.

No external orchestration framework (Airflow, Dagster, Temporal) is used:
the whole refresh is a single-machine, minutes-long, sequential run, so the
DAG lives in code and scheduling stays with the operating system or CI.

## Scope

Data acquisition through validated repository artifacts and the refresh
report. Committing, merging, deploying, and Staging acceptance remain human
decisions (ADR 0028-0035 deployment gates are unchanged).

## Consequences

- The metadata primary is auto-selected: the newest normalized multi-run for
  the Active Planning Term, consolidated across history via
  `--metadata-root`. When that run is missing the refresh fails instead of
  guessing.
- A term appearing in both sources is a hard error by design; resolving it is
  a source decision (ADR 0040), not an orchestrator default.
- Operations notes live in `docs/etl_refresh.md`.
