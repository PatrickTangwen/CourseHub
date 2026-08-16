/**
 * Pure planning logic for the ETL refresh orchestrator: which terms come from
 * which source, and which normalized metadata run anchors the TSS publisher.
 * See docs/etl_refresh.md and ADR 0041.
 */

import { inferredNormalizedRunTimestamp } from '../catalog-snapshot/tssPublishedSnapshotPipeline';
import type { ClassplannerTermEntry } from '../classplanner-scraper/classplannerCatalog';

export type ClassplannerRefreshTerm = {
  term: string;
  courseCount: number;
};

/**
 * Class-Planner-sourced terms are every planner registry term that carries
 * data. A term served by both the live Schedule of Classes window and Class
 * Planner has two competing sources whose snapshots differ in shape (booking
 * packages, live enrollment), so the overlap is a human decision, not a
 * default: the refresh fails before mutating anything. See ADR 0040.
 */
export function planClassplannerTerms(
  plannerTerms: ClassplannerTermEntry[],
  scheduleOfClassesTerms: string[],
): ClassplannerRefreshTerm[] {
  const window = new Set(scheduleOfClassesTerms);
  const withData = plannerTerms.filter((entry) => entry.course_count > 0);
  const conflicts = withData
    .map((entry) => entry.term_code)
    .filter((term) => window.has(term));
  if (conflicts.length > 0) {
    throw new Error(
      `Terms served by both the Schedule of Classes window and Class Planner: ` +
        `${conflicts.join(', ')}. Decide the schedule source for these terms ` +
        `before refreshing (see ADR 0040); nothing was modified.`,
    );
  }
  return withData.map((entry) => ({
    term: entry.term_code,
    courseCount: entry.course_count,
  }));
}

/**
 * The TSS publisher's primary `--metadata-dir`: the newest normalized
 * multi-run for the Active Planning Term. Per-subject consolidation across
 * every preserved run still happens through `--metadata-root`; the primary
 * run only anchors the attributed source timestamp. Returns the directory
 * name (not a full path).
 */
export function selectPrimaryMetadataDirectory(
  runDirectoryNames: string[],
  activePlanningTerm: string,
): string {
  const candidates = runDirectoryNames
    .filter((name) => name.endsWith(`-${activePlanningTerm}`))
    .map((name) => ({
      name,
      timestamp: inferredNormalizedRunTimestamp(name),
    }))
    .filter(
      (candidate): candidate is { name: string; timestamp: string } =>
        candidate.timestamp !== null,
    )
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const [newest] = candidates;
  if (!newest) {
    throw new Error(
      `No normalized multi-run found for the Active Planning Term ` +
        `${activePlanningTerm}. Run the Schedule of Classes refresh first, ` +
        `or pass an explicit metadata directory to the TSS publisher.`,
    );
  }
  return newest.name;
}
