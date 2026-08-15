/**
 * Fetch the full course catalog for a term from the public UCSD Class Planner
 * API (https://classplanner.apps.ucsd.edu). No authentication is required.
 *
 * The Class Planner backend serves the same TSS event data that the legacy
 * OData scraper collected behind SSO login (section ids like "E 00000972"
 * match the tss_event_ids stored in published snapshots).
 *
 * Output layout (under `outRoot/<TERM>/<timestamp>/`):
 *   terms.json    raw /api/v1/planner/terms response
 *   filters.json  raw /api/v1/catalog/filters response for the term
 *   pages/page-<offset>.json  raw paginated /api/v1/catalog/courses pages
 *   courses.json  merged course list with fetch metadata
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const classplannerBaseUrl = 'https://classplanner.apps.ucsd.edu/api/v1';
const PAGE_LIMIT = 48; // Server-enforced maximum.
const DEFAULT_REQUEST_DELAY_MS = 250;

type FetchAdapter = typeof fetch;

export type ClassplannerTermEntry = {
  term_code: string;
  course_count: number;
  section_count: number;
  meeting_count: number;
  last_full_refresh_at: string;
  configured: boolean;
};

export type ClassplannerTermsResponse = { terms: ClassplannerTermEntry[] };

type CoursesPage = {
  term_code: string;
  total: number;
  offset: number;
  courses: unknown[];
};

async function fetchJson(
  url: string,
  fetchAdapter: FetchAdapter,
): Promise<unknown> {
  const response = await fetchAdapter(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(
      `GET ${url} failed: ${response.status} ${response.statusText}`,
    );
  }
  return response.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The planner term registry: the authoritative list of Class-Planner-served
 * terms and their `last_full_refresh_at` availability timestamps.
 */
export async function fetchClassplannerTerms(
  options: { baseUrl?: string; fetch?: FetchAdapter } = {},
): Promise<ClassplannerTermsResponse> {
  const baseUrl = options.baseUrl ?? classplannerBaseUrl;
  const fetchAdapter = options.fetch ?? fetch;
  return (await fetchJson(
    `${baseUrl}/planner/terms`,
    fetchAdapter,
  )) as ClassplannerTermsResponse;
}

export type FetchClassplannerCatalogOptions = {
  term: string;
  /** Run directories are created under `outRoot/<TERM>/<timestamp>/`. */
  outRoot: string;
  baseUrl?: string;
  fetch?: FetchAdapter;
  requestDelayMs?: number;
  fetchedAt?: string;
  log?: (line: string) => void;
};

export type FetchClassplannerCatalogResult = {
  term: string;
  fetchedAt: string;
  runDirectory: string;
  coursesPath: string;
  total: number;
};

/**
 * Fetch one term's full catalog, preserving every raw page response in the
 * run directory before writing the merged `courses.json`.
 */
export async function fetchClassplannerCatalog(
  options: FetchClassplannerCatalogOptions,
): Promise<FetchClassplannerCatalogResult> {
  const term = options.term.toUpperCase();
  const baseUrl = options.baseUrl ?? classplannerBaseUrl;
  const fetchAdapter = options.fetch ?? fetch;
  const requestDelayMs = options.requestDelayMs ?? DEFAULT_REQUEST_DELAY_MS;
  const log = options.log ?? (() => {});
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  const runDirectory = join(
    options.outRoot,
    term,
    fetchedAt.replace(/[:.]/gu, '-'),
  );
  const pagesDirectory = join(runDirectory, 'pages');
  await mkdir(pagesDirectory, { recursive: true });

  const terms = await fetchJson(`${baseUrl}/planner/terms`, fetchAdapter);
  await writeFile(
    join(runDirectory, 'terms.json'),
    JSON.stringify(terms, null, 2),
  );

  const filters = await fetchJson(
    `${baseUrl}/catalog/filters?term_code=${term}`,
    fetchAdapter,
  );
  await writeFile(
    join(runDirectory, 'filters.json'),
    JSON.stringify(filters, null, 2),
  );

  const courses: unknown[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total) {
    const url = `${baseUrl}/catalog/courses?term_code=${term}&limit=${PAGE_LIMIT}&offset=${offset}`;
    const page = (await fetchJson(url, fetchAdapter)) as CoursesPage;
    if (page.term_code !== term) {
      throw new Error(
        `term mismatch on page offset=${offset}: got ${page.term_code}`,
      );
    }
    ({ total } = page);
    await writeFile(
      join(pagesDirectory, `page-${String(offset).padStart(5, '0')}.json`),
      JSON.stringify(page, null, 2),
    );
    courses.push(...page.courses);
    offset += PAGE_LIMIT;
    log(`fetched ${Math.min(offset, total)}/${total}`);
    if (offset < total) await sleep(requestDelayMs);
  }

  if (courses.length !== total)
    throw new Error(`expected ${total} courses, merged ${courses.length}`);

  const merged = {
    schema_version: 'classplanner-catalog-v1',
    source: `${baseUrl}/catalog/courses`,
    term_code: term,
    fetched_at: fetchedAt,
    total,
    courses,
  };
  const coursesPath = join(runDirectory, 'courses.json');
  await writeFile(coursesPath, JSON.stringify(merged, null, 2));

  return { term, fetchedAt, runDirectory, coursesPath, total };
}
