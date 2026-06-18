# ADR-0005: Node.js + Cheerio scraper for course catalog

## Status

Accepted

## Context

Course data (titles, descriptions, prerequisites, units) needs to be sourced from UCSD's Course Catalog at catalog.ucsd.edu. The catalog is static HTML with no public API.

Options considered:
- **Python + BeautifulSoup** — industry standard for scraping, but introduces a second language into a JS/TS project.
- **Node.js + Cheerio** — keeps the entire project in one language ecosystem. Cheerio is fast and well-suited for static HTML parsing.
- **Puppeteer/Playwright** — overkill for static HTML pages that don't require JavaScript rendering.

## Decision

Use Node.js + Cheerio. The scraper lives in-repo at `scripts/scrape-catalog.ts`.

Workflow:
1. Fetch the department index page from catalog.ucsd.edu
2. For each department, fetch its course listing page
3. Parse each course entry: code, title, units, description, prerequisites
4. Write structured data to Postgres via Prisma

The scraper is a one-time ingest script, not a scheduled job. Re-run manually if catalog data needs refreshing.

## Consequences

- Single-language project (TypeScript throughout) — stronger resume narrative.
- Scraper is reproducible: `pnpm run scrape` populates a fresh database.
- No dependency on external APIs or data feeds.
- Data may go stale if not re-scraped. Acceptable for a portfolio project.
- Scraper code in the repo is an interview talking point (data engineering pipeline).
