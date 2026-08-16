# Planning Archive Index

Status: archive navigation aid.

Active implementation planning is tracked in GitHub Issues for
`PatrickTangwen/coursetable-ucsd`. The planning documents in this folder are
historical records preserved for context and audit.

## Read Order

For new agent or human planning work, read in this order:

1. `CONTEXT.md` for domain vocabulary and stable product terms.
2. `docs/README.md` for stable project documentation.
3. `docs/adr/README.md` for durable decisions.
4. GitHub Issues for current executable implementation slices.
5. Archived planning docs only when an issue, ADR, or investigation points to
   historical context.

## Archive Contents

- `archive/`: historical PRDs, roadmap notes, validation records, and milestone
  planning docs.

Cleanup note (2026-07-17): the unused `source-data/` CSV exports were removed.
They were unreferenced starter inputs containing legacy form user identifiers;
the current catalog and Historical GPA pipelines do not consume them. Their
original contents remain available from Git history if an audit ever requires
them.

## Current Planning Policy

- Do not add new active PRDs or roadmap docs under `docs/planning/`.
- Use GitHub Issues for executable implementation slices.
- Put durable decisions in `docs/adr/`.
- Put stable reference documentation in `docs/` and link it from
  `docs/README.md`.
- Put shared domain language in `CONTEXT.md`.
- If a historical doc appears stale, create a new dated note or ADR rather than
  silently rewriting the historical record.
