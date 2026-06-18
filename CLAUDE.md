# CourseHub

UCSD course planning platform for students — course search, grade distribution visualization, drag-and-drop planner, and shareable course plans.

## Tech stack

Uses current latest-stable versions as of the refactor date.

- **Framework**: Next.js 15 (App Router), React 19, TypeScript 5
- **Styling**: Tailwind CSS 4, shadcn/ui component library
- **Database**: Vercel Postgres, Prisma ORM
- **Charts**: Recharts (grade distribution visualization)
- **Drag & drop**: dnd-kit (planner)
- **PDF export**: html2canvas + jsPDF
- **Scraper**: Node.js + Cheerio (one-time catalog ingest, in-repo script)
- **Deployment**: Vercel
- **Package manager**: pnpm

## Architecture

- **SSG** for course/department pages (built at build time from Postgres)
- **API Routes** (Next.js Route Handlers) for: full-text search, shared plan CRUD
- **Client-side**: localStorage for active planner state; Postgres for shared plan persistence
- **No authentication**: fully anonymous. Users share plans via unique URL (`/share/[id]`)

## Features

1. Course search (Postgres full-text search)
2. Course detail (description, prerequisites, units, department)
3. Course comparison (side-by-side)
4. Grade distribution visualization (bar charts, professor comparison)
5. Interactive planner (dnd-kit drag & drop, Year 1-4 × 4 quarters)
6. Classic planner (table-based)
7. PDF export for plans
8. Share plan via unique URL
9. Department browsing
10. Resources (external UCSD links)

## Data sources

- **Course catalog**: scraped from catalog.ucsd.edu via `scripts/scrape-catalog.ts`
- **Grade distributions**: imported from `sheet.csv` via `scripts/seed-grades.ts`
- All data lives in Vercel Postgres after ingest. No runtime scraping.

## Conventions

- Use pnpm, not npm
- Do not push code without asking first
- Keep function argument type annotations minimal

## Agent skills

### Issue tracker

GitHub Issues (via `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.
