/**
 * CLI wrapper for the Class Planner catalog fetcher. See
 * ./classplannerCatalog.ts for the source behavior and output layout.
 *
 * Usage:
 *   bun tools/classplanner-scraper/fetch-classplanner-catalog.mts --term FA26
 */

import { fetchClassplannerCatalog } from './classplannerCatalog.js';

function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${name} requires a value`);
  }
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

const result = await fetchClassplannerCatalog({
  term: argument('--term', 'FA26'),
  outRoot: argument('--out', 'data/raw/classplanner'),
  log: console.log,
});
console.log(`wrote ${result.total} courses to ${result.coursesPath}`);
