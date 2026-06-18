# ADR-0001: Next.js 15 App Router as framework

## Status

Accepted (updated — removed Aug 2023 constraint)

## Context

The original CourseHub was a Vite-bundled SPA on Firebase Hosting with no backend, no database, and no server-side rendering. This refactor rebuilds it as a modern full-stack application using the best available tools.

## Decision

Use Next.js 15 with the App Router. This is the current stable release and the dominant full-stack React framework.

Supporting choices — all latest stable:
- React 19 (Server Components, Server Actions, use() hook)
- TypeScript 5
- Tailwind CSS 4
- shadcn/ui

## Consequences

- App Router provides file-based routing, React Server Components, and built-in Route Handlers — no need for a separate backend server.
- SSG via `generateStaticParams` for course/department pages.
- React 19 Server Components reduce client bundle size for data-heavy pages.
- Server Actions available as an alternative to API routes for mutations (e.g., plan creation), though Route Handlers are used for clarity and RESTful convention.
- Deployment moves from Firebase Hosting to Vercel (Next.js native platform).
