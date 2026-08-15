# Multi-Term Saved Worksheets And Silent Cross-Term Add Routing

Status: accepted. Extends ADR 0010 (Saved Worksheet model and worksheet-management
interface reuse). Does not change the single-term-bound Saved Worksheet data model.

## Context

Signed-in Saved Worksheet accounts were effectively single-term-locked. The
worksheet page bootstraps `ensureMainSavedWorksheetForTerm(CUR_SEASON)` only, the
header shows the active term as a static badge with no term switcher, and adding a
catalog section whose term differs from the active Saved Worksheet was rejected
with an error. Anonymous worksheets, by contrast, are per-term-keyed and silently
route a cross-term add into that term's set. This ADR brings signed-in accounts to
behavioral parity with anonymous worksheets without reviving legacy
worksheet-number semantics and without changing the single-term binding of a
Saved Worksheet.

## Decision

1. **Multi-term navigation for signed-in accounts.** The static active-term badge
   becomes a term selector, paired with the existing worksheet-name selector (two
   dropdowns, matching the original CourseTable shape). The term selector lists all
   Supported Terms. Switching terms bootstraps
   that term (`ensureMainSavedWorksheetForTerm`) and lands on its Active Saved
   Worksheet. Each Saved Worksheet remains bound to exactly one term; this ADR
   changes navigation and add-target resolution, not the data model of ADR 0010.

2. **Cross-term adds route instead of being rejected.** Adding a catalog section
   whose term differs from the viewed term routes the section into that term's
   Active Saved Worksheet rather than erroring. The target is resolved as: the
   term's remembered Active Saved Worksheet (`activeSavedWorksheetIdsByTerm`), else
   that term's Main Worksheet, else a Main Worksheet created on demand. This single
   resolution rule governs three things uniformly: the cross-term add target, the
   catalog add/remove toggle membership for a section, and which worksheet a term
   switch lands on.

3. **Silent routing, no view switch.** A cross-term add does not change the viewed
   term or activate the target worksheet (parity with the anonymous "no-op view"
   behavior). Discoverability comes at view time from a variant-aware empty state
   ("your courses are in <term>"), not from auto-switching or add-time
   notifications. The empty state surfaces only other terms; another worksheet
   within the same term is surfaced by the worksheet-name selector. Which terms
   hold courses is derived from the worksheet summaries (`sectionCount` > 0,
   hidden sections included).

4. **Confirmed (non-optimistic) writes.** Because the target worksheet is
   off-screen, the catalog toggle and count flip only after the backend write
   succeeds (consistent with existing Saved Worksheet add behavior). A successful
   cross-term add is silent; a failed one reverts to "not added" and shows an
   error toast that names the target term.

5. **Remembered viewed term across reload.** The last viewed term is remembered
   client-side and bootstrapped on load instead of the hard-coded `CUR_SEASON`,
   falling back to `CUR_SEASON` if the remembered term is no longer a Supported
   Term. The viewed term stays independent of the Catalog's term.

6. **No backend changes.** This is a frontend slice. Existing endpoints suffice:
   `GET /api/savedWorksheets` (no term) returns all of a user's worksheet
   summaries with `sectionCount` across terms in one call (cheap cross-term discovery);
   `ensure-main`, `:id/sections` (writes any owned worksheet id), and `:id`
   (full sections) cover routing and provisioning.

## Considered Options

- **Keep blocking cross-term adds (status quo).** Rejected: it leaves signed-in
  accounts single-term-locked and divergent from the anonymous experience.
- **Always target the term's Main Worksheet, ignoring the remembered active one.**
  Rejected: it makes cross-term adds inconsistent with same-term adds (which honor
  the active worksheet), so a user curating a non-main worksheet in a term would
  not find catalog-added sections there.
- **Auto-switch the view to the added course's term.** Rejected: it breaks the
  silent "no-op view" parity and, for signed-in accounts, yanks the view through a
  backend bootstrap mid-catalog-browse.
- **Optimistic toggle with rollback.** Rejected: because the target worksheet is
  off-screen, an optimistic "added" that later rolls back is more confusing than a
  confirmed flip, and it diverges from existing Saved Worksheet add behavior.

## Consequences

- The cross-term rejection in `getActiveSavedWorksheetSectionId` is replaced by
  term-routing; the catalog add/remove path resolves the target worksheet by the
  section's own term, not the currently active worksheet.
- The catalog toggle's "is this added?" state for a section is evaluated against
  that section's term Active Saved Worksheet, and a new write path can update a
  non-active worksheet without activating it.
- A catalog add can create a term's Main Worksheet as a side effect (on-demand
  provisioning), so first-time terms appear without an explicit create step.
- The set of terms holding courses comes from one `fetchSavedWorksheets()` call
  and must be refreshed after cross-term writes so the empty state stays accurate.
- Signed-in and anonymous worksheet term behavior converge; the `Worksheet Viewed
Term` and `Active Saved Worksheet` CONTEXT terms carry the shared model.
- Detailed execution should live in GitHub Issues; archived planning context, if
  needed, lives under `docs/planning/archive/`.
