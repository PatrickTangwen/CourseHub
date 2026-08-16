# Forward-Accumulating Term Archive Bounded By Source Availability

Status: accepted. Extends the multi-term direction in
`docs/planning/archive/post-mvp-roadmap.md`; depends on ADR 0001.

## Context

The product goal "support UCSD course selection across many terms from 2021 to
present, all subjects" assumed historical term schedules are fetchable. They are
not. The live UCSD Schedule of Classes
(`act.ucsd.edu/scheduleOfClasses/subject-list.json?selectedTerm=<term>`) only
serves a rolling window of recent terms. Empirical probe on 2026-06-26: SP25,
FA25, WI26, SP26, Summer 2026, and FA24 return full subject lists; SP24 and all
of 2021-2023 return empty `[]`. So 2021 section / meeting / seat data cannot be
retrieved from the source at all.

The only genuinely historical UCSD source is the Instructor Grade Archive (GPA by
subject / year / quarter, see ADR 0003). The General Catalog is term-agnostic
current descriptions, not a historical record.

## Decision

1. **Align to data reality.** Live schedule snapshots are produced only for terms
   inside the current Term Window. "2021 to present" history is delivered as
   Historical GPA from the Grade Archive, surfaced in course detail — not as
   fabricated historical term snapshots.

2. **Forward accumulation.** Each run snapshots every term in the Term Window
   (including recent past terms the source still serves). When a term falls out
   of the Window, its last snapshot becomes a Frozen Snapshot (marked frozen with
   its `generated_at` timestamp) and is never regenerated or deleted. The Term
   Archive grows forward over time. Because 2021 is unreachable, forward
   accumulation is the only achievable path to multi-term depth.

3. **Durable external storage.** Published and Frozen Snapshots live in external
   object storage / CDN, not git (`api/static/**/*.json` is already gitignored),
   so the frozen archive survives regenerations and deploys. Raw and normalized
   artifacts stay local / cold storage for audit only and are not served.

## Consequences

- The term selector must be driven by a metadata term registry (Supported Terms),
  not the inherited numeric `seasons.json` (whose codes have no snapshot files).
- Availability display must distinguish current vs frozen terms — see ADR 0014.
- Subjects are discovered per term from `subject-list.json`, not from a static
  configured list, so terms with different offered-subject sets work correctly.
- Regeneration cadence must be frequent enough to snapshot a term before it leaves
  the Term Window; a missed window means that term is lost permanently.
