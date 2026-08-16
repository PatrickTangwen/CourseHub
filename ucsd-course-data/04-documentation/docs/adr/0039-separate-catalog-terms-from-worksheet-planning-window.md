# Separate Catalog Terms From The Worksheet Planning Window

Status: accepted. Refines ADR 0015 by narrowing its term-selector and cross-term
add/remove decisions to the Worksheet Planning Window.

## Context

The Catalog's Supported Terms form a forward-accumulating archive. Keeping older
Published and Frozen Snapshots available is useful for course discovery and
historical comparison, but it does not mean every archived term should remain an
operable schedule-planning target.

ADR 0015 treated all Supported Terms as both browsable and worksheet-operable.
Once the Catalog retained terms older than the current planning horizon, that
coupling exposed add/remove controls for terms the Worksheet selector should no
longer offer. The Catalog archive and the Worksheet planning surface therefore
need separate term boundaries.

## Decision

1. **Use Fall 2026 as the Active Planning Term.** `FA26` is the default selected
   term for both the Catalog and Worksheet and the fallback when a remembered
   Worksheet Viewed Term is no longer operable.

2. **Define a narrower Worksheet Planning Window.** The inclusive window is
   Summer Session I 2026 through Fall 2026: `S126`, `S226`, `S326`, and `FA26`.
   The Worksheet Calendar and List term selectors expose only these terms.

3. **Keep the Catalog term archive independent.** All Supported Terms remain in
   the Catalog term selector. Terms before `S126`, including `SP26` and earlier,
   remain available for browsing.

4. **Hide actions outside the planning window.** Catalog course rows, cards, and
   course-detail modals do not render worksheet add/remove controls for sections
   outside the Worksheet Planning Window. The controls are suppressed rather
   than shown disabled because those terms are browse-only in the current product
   model.

5. **Retain existing worksheet data.** A persisted Worksheet Viewed Term outside
   the window normalizes to the Active Planning Term. Existing browser-local or
   account-backed course sets for older terms are not deleted, but the Worksheet
   selector and Catalog actions do not expose those terms as operable targets.

6. **Preserve in-window cross-term routing.** Within the Worksheet Planning
   Window, ADR 0015 still governs per-term worksheet ownership, silent cross-term
   add routing, and the rule that adding a section does not switch the viewed
   term.

## Considered Options

- **Make every Supported Term worksheet-operable.** Rejected: the Catalog archive
  will continue accumulating historical terms, while the Worksheet is intended
  for a bounded planning horizon.
- **Remove older terms from the Catalog.** Rejected: this would discard useful
  browse-only access and undermine the forward-accumulating Term Archive.
- **Show disabled add/remove controls for older terms.** Rejected: hiding actions
  communicates the browse-only boundary without presenting an unavailable task.

## Consequences

- `Supported Term` and `Worksheet Planning Window` are distinct product concepts
  and must not share one selector source implicitly.
- Advancing the Active Planning Term or changing the lower planning boundary
  requires an explicit product decision and corresponding test updates; adding a
  Catalog snapshot alone must not silently expand worksheet operability.
- Historical worksheet data remains preserved even when its term is no longer
  selectable or editable through the current UI.
- Catalog list, card, modal, Worksheet Calendar, and Worksheet List behavior must
  be covered by the same planning-window policy.
