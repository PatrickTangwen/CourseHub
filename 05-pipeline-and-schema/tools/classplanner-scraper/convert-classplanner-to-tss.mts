/**
 * CLI wrapper for the Class Planner -> tss-chatbot-v1 converter. See
 * ./classplannerToTss.ts for the reconstruction rules.
 *
 * Usage:
 *   bun tools/classplanner-scraper/convert-classplanner-to-tss.mts \
 *     --run-dir data/raw/classplanner/FA26/<timestamp>
 *
 * Writes <run-dir>/tss/schedule.json.
 */

import { convertClassplannerRunToTss } from './classplannerToTss.js';

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

const runDirectory = argument('--run-dir');
const result = await convertClassplannerRunToTss({
  runDirectory,
  ...(process.argv.includes('--out')
    ? { outDirectory: argument('--out') }
    : {}),
});
console.log(
  JSON.stringify(
    {
      out: result.out,
      courses: result.courses,
      booking_choices: result.booking_choices,
      components: result.components,
      distinct_events: result.distinct_events,
      meetings: result.meetings,
      availability_observed_at: result.availability_observed_at,
    },
    null,
    2,
  ),
);
