# Use The Public Class Planner API As The Schedule Source

Status: accepted. Extends ADR 0036 for FA26-and-later schedule acquisition.

## Decision

FA26-and-later schedule data is acquired from the public UCSD Class Planner
API (`https://classplanner.apps.ucsd.edu/api/v1/...`) instead of
authenticated TSS exports (OData pulls or TritonGPT chatbot/CSV captures).
The scraper and converter live in `tools/classplanner-scraper/`; the
converter emits the existing `tss-chatbot-v1` contract, so the Published
Snapshot pipeline, its ADR 0036-0038 semantics, and the frontend stay
unchanged.

Class Planner serves the same TSS event data: its section ids are the TSS
event ids already stored in published `raw.tss_event_ids`. Booking choices are
reconstructed from `event_package_ids` plus the `FAMILY-INDEX-TYPE`
section-code hierarchy; the reconstruction rules and their validation against
the prior OData-derived FA26 snapshot are recorded in
`docs/snapshot_pipe.md` (Class Planner Catalog Source).

## Why

The prior acquisition path required a student SSO login and manual or
scripted TSS sessions. Class Planner exposes the full term catalog — sections,
meetings, exams, instructors, and live enrolled/seat counts — behind an
unauthenticated JSON API with pagination, which makes refreshes reproducible
and removes credential handling from the pipeline.

## Constraints

- Raw page responses are preserved per run under
  `data/raw/classplanner/<TERM>/<timestamp>/` before any conversion.
- Availability remains a timestamped static snapshot; the term registry's
  `last_full_refresh_at` provides the availability timestamp.
- The ADR 0037 availability supplement stays supported by the pipeline but is
  unnecessary for this source, which carries enrollment directly.

## Consequences

Refreshing a term is three commands with no login step. TritonGPT CSV capture
(`docs/tritongpt_schedule_csv.md`) remains a supported fallback input
contract, no longer the preferred one. If UCSD authenticates or removes the
Class Planner API, the pipeline can fall back to the CSV path without contract
changes.
