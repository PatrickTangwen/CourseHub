# Per-Cell Partial Snapshot Generation With Import Manifest

Status: accepted. Supersedes the global fail-hard rule of ADR 0005 at multi-term
/ all-subject scale.

## Context

All ~187 UCSD subjects across the multi-term window times three sources is roughly
1000-1500 sequential, unthrottled HTTP fetches per full run. ADR 0005's rule — any
subject or source fetch/parse failure exits non-zero and publishes nothing — makes
a complete run statistically impossible at this scale: one transient blip discards
the entire batch.

The previous pipeline also conflates three different "failures": transient
infrastructure errors, structural parser breakage, and legitimately empty results
(a subject not offered in a term, or with no grade archive rows). The current
Schedule of Classes loader throws on "subject not found in term's subject list"
and "no courses returned", which are normal at all-subjects scale.

## Decision

Snapshot generation is partial-tolerant per `(term, subject, source)` cell:

- **Transient / infra failures** (network, rate limit, 5xx) are retried with
  backoff before counting as a failure.
- **Legitimately empty** results are recorded as zero, not errors. Subjects are
  discovered per term from `subject-list.json`, so "subject not offered" never
  throws.
- **Persistent cell failure** skips only that cell; the rest of the term still
  publishes. Every cell's status (ok / failed / partial) is written to a per-term
  Import Manifest published with the snapshot and indexed in metadata, so gaps are
  auditable, never silent.
- **Systemic parser breakage** (a source's parse fails across a large fraction of
  subjects — the source HTML shape changed) aborts the whole batch loudly, because
  the data is no longer trustworthy.

## Why

This preserves ADR 0005's real intent — no silent degradation, trustworthy and
auditable data — while making large-scale multi-term generation completable. The
Import Manifest replaces "all-or-nothing" with "everything, plus a published list
of exactly what is missing."

## Consequences

- A published term may legitimately have some subjects missing; the manifest and
  metadata must surface this to consumers and audits.
- "Systemic" vs "isolated" parser failure needs an explicit threshold (e.g. parse
  fails on more than N% of a source's discovered subjects → abort the batch).
