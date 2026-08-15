# Populate UCSD Course Data Across Multiple Terms — Plan (2026-06-26)

Status: active planning doc for moving the UCSD catalog pipeline from a single
active term to a forward-accumulating, all-subject, multi-term archive. Records
the decisions from the 2026-06-26 grilling session and the dependency-ordered
implementation slices. Durable decisions live in the ADRs referenced below;
vocabulary lives in `CONTEXT.md`. This doc is the map, not the source of truth.

## Goal

Let users browse and plan UCSD courses across multiple terms, with course
history reaching back toward 2021 — **reframed to what the data sources can
actually provide** (see Key Finding). The end state is:

- Live schedule snapshots (sections, meeting times, instructors, static seats)
  for every term inside the UCSD source's current Term Window.
- A forward-accumulating Term Archive: each windowed term is snapshotted, then
  frozen and kept forever as it leaves the window.
- All ~187 UCSD subjects, discovered per term.
- Pre-window history (e.g. 2021) delivered only as Historical GPA, surfaced in
  course detail.

## Key Finding That Reshaped The Goal

The original ask ("support course selection from 2021 across all subjects")
assumed historical term schedules are fetchable. **They are not.** The live UCSD
Schedule of Classes only serves a rolling window of recent terms.

Empirical probe of
`act.ucsd.edu/scheduleOfClasses/subject-list.json?selectedTerm=<term>` on
2026-06-26:

| Terms returning a full subject list       | Terms returning empty `[]`                                |
| ----------------------------------------- | --------------------------------------------------------- |
| SP25, FA25, WI26, SP26, Summer 2026, FA24 | SP24 and all of 2021–2023; future terms beyond the window |

So 2021 section/seat data cannot be retrieved at all. The only genuinely
historical UCSD source is the Instructor Grade Archive (GPA by subject / year /
quarter). The General Catalog is term-agnostic current descriptions. This is why
"2021" becomes a GPA-history floor, not a browsable term. See **ADR 0012**.

## Decisions

| #   | Branch                 | Decision                                                                                                                                  | Record              |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1   | Core goal              | Align to data reality: live schedules for the Term Window; 2021 history = GPA only                                                        | ADR 0012            |
| 2   | Subject scope          | All ~187 subjects on the first full run (big-bang), discovered per term                                                                   | —                   |
| 3   | Failure policy         | Per-cell `(term, subject, source)` partial tolerance + published Import Manifest; retry transient; abort only on systemic parser breakage | ADR 0013            |
| 4   | Term scope             | Snapshot the full Term Window, freeze on exit, accumulate forward (append-only archive)                                                   | ADR 0012            |
| 5   | Availability display   | Show `enrolled/capacity/waitlist` for all terms, with staleness copy by term state (current vs frozen)                                    | ADR 0014            |
| 6   | Storage                | Published + Frozen Snapshots in external object storage / CDN; raw/normalized local/cold for audit only                                   | ADR 0012            |
| 7   | GPA summary            | No single collapsed course-level GPA number; Past Grades detail only (all years)                                                          | ADR 0014            |
| 8   | Worksheet × past terms | Keep current behavior (warn, not block); fix two bugs; make anonymous worksheet per-term-keyed                                            | CONTEXT (Worksheet) |

## Current vs Target Architecture

| Concern               | Current                                                        | Target                                                               |
| --------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| Terms per run         | One `active_planning_term`                                     | All Term Window terms                                                |
| Subjects              | Static `configured_subjects` (4)                               | Discovered per term from `subject-list.json` (~187)                  |
| Failure               | Global fail-hard, no partial publish (ADR 0005)                | Per-cell partial + Import Manifest (ADR 0013)                        |
| Term-agnostic sources | Re-fetched per run                                             | General Catalog + Grade Archive fetched once, not per term           |
| `metadata.json`       | Single-term pointer, overwritten each run                      | Term registry: all Supported Terms + per-term manifest + frozen flag |
| Frontend term list    | Inherited numeric `seasons.json` (no matching files → 404)     | Driven by the metadata term registry (UCSD alpha codes)              |
| Catalog table         | Renders all rows, no virtualization                            | Virtualized (must scale to tens of MB/term)                          |
| Snapshot storage      | Local gitignored dir, ephemeral                                | External object storage / CDN, frozen archive persists               |
| Course GPA            | `archive_avg_gpa` (most-recent-term) shown as a number         | No single number; Past Grades only                                   |
| Anonymous worksheet   | `{ term, courses[] }`, silently flips `term` on cross-term add | `{ [term]: courses[] }`, per-term-keyed                              |

## Implementation Plan (dependency-ordered slices)

Validate the riskiest integration first — the end-to-end multi-term wiring — on a
small scope before scaling subjects.

### Slice 0 — Spikes / prerequisites (de-risk before building)

- Confirm Term Window enumeration: enumerate candidate codes
  (`WI/SP/S1/S2/S3/FA` × recent years) and probe `subject-list.json`; treat
  non-empty as available. No hard-coded term map.
- Confirm Grade Archive depth actually reaches 2021 (and earlier) for a sample
  of subjects.
- Design the `metadata.json` term-registry schema (term code, label, date range,
  `frozen` flag, snapshot path, manifest path). Output: a written schema.

### Slice 1 — Thin vertical multi-term slice (small scope, end-to-end)

Goal: prove multi-term browsing works for ~2–3 window terms × a handful of
subjects, all the way to the UI. Governs ADR 0012 / 0013.

- Multi-term runner: loop Term Window terms; fetch term-agnostic sources
  (General Catalog, Grade Archive) **once**, Schedule of Classes per term.
- Per-term subject discovery from `subject-list.json`.
- Per-cell partial tolerance + Import Manifest; transient retry with backoff;
  fetch throttling / concurrency cap (politeness to UCSD).
- Term registry `metadata.json`.
- Frontend: drive the catalog season selector from the registry; deprecate the
  numeric `seasons.json` path. Confirm `<TERM>.json` fetch works for each.
- Acceptance: switch between two window terms in the UI and see correct catalogs;
  a deliberately failed cell appears in the manifest, not as a crashed run.

### Slice 2 — Scale to all 187 subjects

Depends on Slice 1 + frontend virtualization.

- Flip subject discovery to the full per-term list.
- Frontend catalog table virtualization (handle tens of MB / term).
- Tune throttling/concurrency for ~1000–1500 fetches/run.
- Wire external object storage / CDN; implement freeze-on-window-exit and
  never-delete retention (ADR 0012).
- Acceptance: a full run completes with a manifest; large terms render without
  freezing the table; a frozen term still serves after the next run.

### Slice 3 — Display + worksheet semantics (can parallel Slice 2)

- Availability staleness by term state: "Updated N days ago" for current/upcoming;
  explicit historical label for frozen/past (ADR 0014).
- Remove the single course-level GPA number; keep Past Grades (all years)
  (ADR 0014). Drop the GPA column/sort from the catalog table.
- Worksheet fixes (CONTEXT → Worksheet):
  - Anonymous worksheet → per-term-keyed `{ [term]: courses[] }`.
  - Remove the silent `term` reassignment in `anonymousWorksheet.ts` (the
    `season_code ?? worksheet.term` line).
  - Replace the `CUR_YEAR = ['SP26']` literal with a date-range/window-based
    "plannable" predicate so only genuinely ended terms show the "ended" warning.
  - Drive the worksheet `SeasonDropdown` from the same metadata term registry.

## Open Questions (not yet decided)

- Regeneration cadence: how often to run so terms are snapshotted before leaving
  the window (a missed window = permanent loss). Connects to `snapshot:schedule`.
- Share-URL semantics under multi-term (worksheet/search links carrying a term).
- Exact "systemic parser breakage" abort threshold (e.g. parse fails on > N% of a
  source's discovered subjects).

## Validation

Existing snapshot scripts (run via the repo's package manager; the repo currently
wires these as Bun scripts, and a pnpm migration appears in-flight per the
untracked `pnpm-workspace.yaml`):

```
snapshot:publish      # full pipeline → published snapshot(s)
test:snapshot         # pipeline unit/integration tests
```

Use `$tdd` when changing parser, term enumeration, partial-failure, manifest, or
multi-term pipeline behavior. Add tests for: per-term subject discovery, per-cell
partial + manifest, term-agnostic-source-fetched-once, and the term registry
shape. If frontend/API contracts change, type-check and build the frontend.

## References

- `docs/adr/0012-forward-accumulating-term-archive-bounded-by-source.md`
- `docs/adr/0013-per-cell-partial-snapshot-with-import-manifest.md`
- `docs/adr/0014-multi-term-display-semantics.md`
- `docs/adr/0001-catalog-snapshot-for-mvp-1.md`,
  `docs/adr/0003-...`, `docs/adr/0005-...`, `docs/adr/0011-...` (amended/superseded)
- `CONTEXT.md`: Term Window, Supported Term, Frozen Snapshot, Term Archive,
  Import Manifest, Discovered Subject, Worksheet, Snapshot Availability Data
- `docs/planning/archive/post-mvp-roadmap.md`: roadmap sequencing this work fits into
  (Beta-2 multi-term + subject expansion)
