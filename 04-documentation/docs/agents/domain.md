# Domain Docs

This repo uses a single-context domain documentation layout.

## Before exploring, read these

- `CONTEXT.md` at the repo root, if it exists.
- `docs/adr/`, reading ADRs that touch the area being worked on.

If these files do not exist, proceed silently. The `/domain-modeling` skill creates them lazily when terms or decisions actually get resolved.

## File structure

```text
/
|-- CONTEXT.md
|-- docs/adr/
`-- src/
```

## Use the glossary's vocabulary

When output names a domain concept, use the term as defined in `CONTEXT.md`.

If the concept is missing, either reconsider the wording or note it for `/domain-modeling`.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding.
