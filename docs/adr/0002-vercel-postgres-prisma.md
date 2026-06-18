# ADR-0002: Vercel Postgres + Prisma for data storage

## Status

Accepted

## Context

The original site used static CSV/JSON files with no database. We need structured storage for:
1. Course catalog data (scraped from catalog.ucsd.edu)
2. Grade distribution data (imported from student-submitted CSV)
3. Shared course plans (user-generated, persisted for shareable URLs)

Considered alternatives:
- Firebase Firestore — already in use, but poor fit with Next.js SSG/API patterns
- PlanetScale (MySQL) — popular in 2023, but free tier was removed in 2024
- SQLite — no server needed, but doesn't work on Vercel serverless

## Decision

Use Vercel Postgres (backed by Neon) with Prisma ORM.

## Consequences

- Seamless integration with Vercel deployment (connection pooling, env vars auto-configured).
- Prisma provides type-safe queries, schema migrations, and seed scripts.
- All data (courses, departments, professors, grade distributions, shared plans) lives in one Postgres instance.
- Full-text search for courses uses Postgres `tsvector`/`tsquery` — no need for a separate search service.
- Free tier: 256MB storage, sufficient for course catalog + grade data.
