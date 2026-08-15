# Worksheet Section ID Compatibility

Status: current implementation note, 2026-07-22.

Worksheet entries persist the Published Snapshot Section ID. TSS package
grouping can expand a previously published single-component ID into a package
ID when an additional required component becomes available. For example:

```text
FA26:BENG-002:E00002597
FA26:BENG-002:E00002597+EL00002326
```

During worksheet restoration, SunGrid treats the newer ID as a compatible
replacement only when all of the following are true:

1. The term and course namespace are unchanged.
2. Every component in the stored ID is present in the current package ID.
3. Exactly one current Section satisfies that strict-superset relationship.

The replacement is persisted to the browser-local Anonymous Worksheet or the
account-owned Saved Worksheet so later membership and edit operations use the
current canonical ID.

If zero or multiple current Sections match, SunGrid does not guess. The stored
ID remains unresolved and the existing missing-section warning is shown. This
preserves the user's choice when one shared component now belongs to multiple
bookable packages.

This compatibility rule supplements the Section ID definition in `CONTEXT.md`.
It does not make meeting data, titles, instructors, or course codes alternative
Section identities.
