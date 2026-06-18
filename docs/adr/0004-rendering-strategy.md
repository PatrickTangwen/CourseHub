# ADR-0004: Mixed rendering strategy (SSG + API Routes + CSR)

## Status

Accepted

## Context

Different parts of the app have different data characteristics:

- Course and department pages: data changes only when the scraper re-runs (rarely). High read volume.
- Search: dynamic query against the full course catalog. Needs server-side processing.
- Planner: highly interactive client-side UI with drag-and-drop. No server involvement except for sharing.
- Shared plan viewer: needs to fetch a specific plan by ID at request time.

## Decision

Use three rendering strategies matched to data characteristics:

| Page | Strategy | Why |
|------|----------|-----|
| Course detail `/courses/[id]` | SSG (`generateStaticParams`) | Static data, pre-built at deploy time |
| Department listing `/departments` | SSG | Static data |
| Department detail `/departments/[id]` | SSG | Static data |
| Home page `/` | SSG | Static content |
| Search results | CSR + API Route | Dynamic query, needs `/api/search` |
| Planner `/planner` | CSR | Client-only interactivity |
| Shared plan `/share/[id]` | SSR | Needs to fetch specific plan from DB |
| About, Resources | SSG | Static content |

## Consequences

- Fast page loads for course/department pages (pre-rendered HTML).
- React 19 Server Components used by default for data-fetching pages — reduces client JS bundle.
- Search stays responsive via client-side fetch to API route.
- Planner is a fully client-side React app (marked `"use client"`) within the Next.js shell.
- Demonstrates understanding of when to use SSG vs SSR vs CSR and how React Server Components fit in.
