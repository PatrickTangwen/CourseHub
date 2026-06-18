# ADR-0001: Next.js 13.4 App Router as framework

## Status

Accepted

## Context

This project is listed under internship experience on the resume (August 2023 timeframe). The tech stack must be credible for that period. The original site was a Vite-bundled SPA on Firebase Hosting with no backend, no database, and no server-side rendering.

## Decision

Use Next.js 13.4+ with the App Router (stable as of May 2023). This was the cutting-edge full-stack React framework choice in August 2023.

Supporting choices locked to the same era:
- React 18 (not 19)
- Tailwind CSS 3 (not 4)
- shadcn/ui (launched Jan 2023, peak hype by Aug 2023)
- TypeScript 5.x

## Consequences

- App Router provides file-based routing, server components, and built-in API route handlers — no need for a separate backend server.
- SSG via `generateStaticParams` for course/department pages.
- Cannot use React 19 features (use(), Server Actions as stable API) — they postdate the resume timeline.
- Deployment moves from Firebase Hosting to Vercel (Next.js native platform).
