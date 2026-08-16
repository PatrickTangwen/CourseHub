# Beta-1 Save Anonymous Worksheet To Account

Status: planning record for the next post-MVP product slice.

Date: 2026-06-21

## GitHub Issues

- Parent PRD: [#24](https://github.com/PatrickTangwen/coursetable-ucsd/issues/24)
  `[PRD] Beta-1 Save Anonymous Worksheet To Account`
- Save vertical slice:
  [#27](https://github.com/PatrickTangwen/coursetable-ucsd/issues/27)
  `Beta-1: Save Anonymous Worksheet As Saved Worksheet`
- Restore vertical slice:
  [#25](https://github.com/PatrickTangwen/coursetable-ucsd/issues/25)
  `Beta-1: Restore Saved Worksheet From Account`
- Acceptance/browser smoke:
  [#26](https://github.com/PatrickTangwen/coursetable-ucsd/issues/26)
  `Beta-1: Saved Worksheet Acceptance And Browser Smoke`

## Decision

The next post-MVP implementation slice should be `Beta-1 Save Anonymous
Worksheet To Account`.

This is the first signed-in product capability after Beta-1 auth validation. A
signed-in user explicitly saves the current Anonymous Worksheet into their
account as a Saved Worksheet. Login itself must not automatically save, merge,
or sync anonymous worksheet state.

## 2026-06-22 Supersession Note

This document records the completed transitional save/restore slice (#24, #27,
#25, and #26). The current Saved Worksheet Management UX is governed by
`docs/planning/archive/beta-1-saved-worksheet-management-2026-06-22.md` and ADR 0010's
2026-06-22 interaction alignment note. In the current worksheet page, signed-out
users and signed-in users share the same visible worksheet interaction model;
the persistence backend changes from browser local storage to account Saved
Worksheet after sign-in. The page no longer exposes a default
save/restore/import panel for browser-local worksheet state. Future copy/import
from browser-local state into an account worksheet should be planned as a
separate explicit feature.

## Current Baseline

Completed foundations:

- MVP-1 public Catalog Snapshot, catalog search, Anonymous Worksheet, share URL,
  conflict detection, and ICS export.
- Beta-0 hard-disable cleanup of inherited CourseTable/Yale public surfaces.
- Beta-1 Verified UCSD Email auth foundation.
- Internal App User ID ownership model.
- Real backend auth validation through the local Compose stack.
- Saved Search ownership validation through `user_id`.

Current repo state observed on 2026-06-21:

- `main` and `origin/main` are synchronized.
- The active GitHub issue backlog for this slice is #24 through #27.
- Existing worksheet persistence code still contains legacy Yale `netId` and
  `crn` assumptions.
- Anonymous Worksheet state already stores `term`, `sectionId`, `color`, and
  `hidden` in browser-local storage.

## Product Goal

Give signed-in UCSD users a concrete account benefit without changing the
Catalog Snapshot read contract:

- Start planning anonymously.
- Sign in with Verified UCSD Email.
- Click an explicit save action.
- Restore the saved worksheet from another browser or session.

## Scope

### User-Facing Behavior

- A signed-in user can save the current Anonymous Worksheet to their account.
- An anonymous user can see that saving requires sign-in, but signing in does
  not save automatically.
- The save action has a user-visible worksheet name field.
- The default name can be generated from the term, for example
  `FA26 Worksheet`, but the user can edit it before saving.
- Saving creates a new Saved Worksheet owned by the current App User ID.
- Saving does not merge into an existing Saved Worksheet in this slice.
- Duplicate Saved Worksheet names are allowed unless the implementation chooses
  a simple non-blocking suffix strategy.
- Duplicate section IDs inside the submitted Anonymous Worksheet are deduped.
- A saved worksheet is account-private by default.
- Share URL export remains an Anonymous Worksheet feature; account sharing is
  later scope.

### Restore Behavior

- A signed-in user can load at least a minimal list of their Saved Worksheets.
- Selecting a Saved Worksheet restores its sections into the worksheet view.
- The first slice only needs enough list/detail behavior to prove cross-browser
  restore.
- Rich worksheet management, such as rename, delete, sorting, duplicate
  detection, and privacy controls, can follow as a separate hardening slice.

### Section Identity

- A Saved Worksheet stores section IDs as the stable product identity.
- It must not store title, professor, time, or meeting text as the source of
  truth.
- If a section ID cannot be resolved against the current Published Snapshot, the
  Saved Worksheet still loads with a warning.
- Missing section IDs should not be silently dropped.
- Display details should continue to come from the Catalog Snapshot.

### Ownership

- Saved Worksheet ownership is by App User ID.
- Legacy `netId` fields may be populated only as compatibility adapter fields
  if existing tables require them.
- New product logic should not treat UCSD email local-parts, legacy `netId`, or
  browser identity as ownership.

## Recommended API Shape

The exact route names can change during implementation, but the contract should
look like this:

- `POST /api/savedWorksheets/from-anonymous`
  - Requires UCSD app session.
  - Body: worksheet name, term, and anonymous worksheet courses
    `{ sectionId, color, hidden }`.
  - Response: saved worksheet id, name, term, created time, and resolved/missing
    section summary.
- `GET /api/savedWorksheets`
  - Requires UCSD app session.
  - Returns the current user's Saved Worksheets.
- `GET /api/savedWorksheets/:id`
  - Requires UCSD app session.
  - Returns one Saved Worksheet owned by the current App User ID, including
    stored section IDs and missing section IDs after snapshot resolution.

The implementation can use a store interface, similar to Saved Search, so tests
can cover ownership and missing-section behavior without requiring a live
database in every unit test.

## Recommended Data Shape

Prefer a UCSD App DB shape based on `user_id` and section IDs:

- `savedWorksheets`
  - `id`
  - `userId`
  - `term`
  - `name`
  - `createdAt`
  - `updatedAt`
  - optional/private visibility field, defaulting to private behavior
- `savedWorksheetSections`
  - `id`
  - `worksheetId`
  - `sectionId`
  - `color`
  - `hidden`

If the implementation adapts existing `worksheets` and `worksheetCourses`
tables instead, it should add canonical `userId` and `sectionId` behavior rather
than making legacy `netId` and `crn` authoritative for the UCSD Saved Worksheet
feature.

## Acceptance Criteria

- Signed-in UCSD users can save the current Anonymous Worksheet by explicit
  action.
- Anonymous users are prompted to sign in before saving, with no protected API
  call made while anonymous.
- Signing in does not automatically save or sync the Anonymous Worksheet.
- Saved Worksheet records are owned by App User ID.
- User A cannot read or modify User B's Saved Worksheets.
- Saved Worksheet storage preserves term, section ID, color, and hidden state.
- Saved Worksheet display resolves current course/section details from the
  Catalog Snapshot.
- Missing section IDs after snapshot changes show a user-facing warning.
- A saved worksheet can be restored after logout/login or from another browser
  session.
- Existing Anonymous Worksheet behavior, share URL restore, conflict detection,
  and ICS download continue to work.
- The implementation includes a browser smoke that signs in with a development
  verification code, saves an Anonymous Worksheet, logs out or opens a fresh
  browser context, signs in again, and restores the Saved Worksheet.

## Tests And Validation

Recommended validation set:

- API tests for auth requirement, invalid body handling, create/list/detail, and
  cross-user isolation.
- Store tests for duplicate section ID dedupe and missing section ID reporting.
- Frontend tests for the anonymous save gate and signed-in save success state,
  if the UI surface is testable without brittle DOM coupling.
- `bun run typecheck`.
- Targeted API and frontend tests touched by the implementation.
- Real backend validation against local Compose if schema or session behavior is
  changed.
- Browser smoke over `/catalog`, `/worksheet`, login, save, restore, and ICS
  download.

## Explicit Non-Scope

- Automatic Anonymous Worksheet save on login.
- Merge or conflict resolution between an Anonymous Worksheet and an existing
  Saved Worksheet.
- Full Saved Worksheets list/detail product hardening.
- Rename/delete Saved Worksheet management, unless trivial after the base slice.
- Public/private sharing controls beyond private-by-default behavior.
- Friend worksheet viewing.
- Wishlist.
- Saved Search hardening.
- Production-like email delivery.
- Google OAuth.
- Google Calendar direct export.
- Multi-term snapshot support.
- Subject expansion.
- Course Data Store or Hasura redesign.
- Availability Data, waitlist, enrollment, open seats, or worksheet demand.
- SET/CAPE or personal UCSD account integration.

## Suggested Issue Split

Use vertical slices rather than API-only and UI-only issues:

1. Parent tracking issue: `Beta-1: Save Anonymous Worksheet To Account`.
   - Tracks the PRD and issue sequence.
   - Do not implement directly.
2. `Beta-1: Save Anonymous Worksheet As Saved Worksheet`.
   - Blocked by: none.
   - Delivers the first demoable path: schema/store/API plus a minimal save
     action, name input/default, anonymous sign-in gate, signed-in save success,
     and tests.
3. `Beta-1: Restore Saved Worksheet From Account`.
   - Blocked by: the save slice.
   - Delivers a minimal saved worksheet list/detail/selector, cross-session
     restore, missing Section ID warning, and tests.
4. `Beta-1: Saved Worksheet Acceptance And Browser Smoke`.
   - Blocked by: save and restore slices.
   - Validates the full path with targeted checks plus Playwright or equivalent
     manual browser smoke.

## After This Slice

Recommended next options after this slice is complete:

1. `Beta-1 Saved Worksheets List/Detail Hardening`
   - Add rename, delete, better selectors, duplicate-copy handling, empty states,
     and clearer saved-vs-anonymous mode switching.
   - Best next step if the goal is to make schedule persistence feel complete.

2. `Production-Like Email Delivery`
   - Choose provider, sender domain, secret management, abuse/rate limits,
     retry behavior, and failure UI.
   - Best next step before inviting real users who cannot rely on development
     verification codes.

3. `Saved Search Product Hardening`
   - Finish rename/delete/list/apply polish, stale URL behavior, and empty/error
     states.
   - Best next step if catalog workflow polish matters more than worksheet
     management.

4. `Wishlist`
   - Add account-owned course-level interest tracking using Course IDs, not
     Section IDs.
   - Best after Saved Worksheet restore is stable, because both use App DB
     ownership but have different identity semantics.

5. `Beta-2 Multi-Term Support`
   - Add supported term selection, multiple Catalog Snapshots, and term-scoped
     worksheet rules.
   - Larger data/product step; do not mix into the first Saved Worksheet slice.

6. `Deployment And Automation`
   - Hosting, scheduled snapshot generation, alerts, rollback, monitoring, and
     privacy/disclaimer pages.
   - Best when the product is ready for sustained beta use.

Lower-priority later items remain GE mapping, prerequisite graph research,
subject expansion, Google Calendar direct export, and SET/CAPE review. Those
should stay separate from the Saved Worksheet persistence path unless a new ADR
explicitly changes the roadmap.
