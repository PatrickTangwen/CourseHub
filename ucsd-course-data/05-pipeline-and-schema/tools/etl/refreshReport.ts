/**
 * Refresh report for the ETL orchestrator: a truthful summary of what a
 * refresh actually changed in the published snapshot JSON, computed by
 * diffing the preserved before-state against the refreshed files.
 *
 * DuckDB parses each published snapshot and digests the raw JSON text of
 * every course row (no schema inference), so a reported change is always a
 * byte-level change in that course's published data. Import Manifest
 * summaries are attached as evidence, not as success labels; see
 * docs/snapshot_pipe.md.
 */

import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

// FA24.json alone is tens of MB; give the JSON reader ample headroom.
const MAX_OBJECT_SIZE = 1_073_741_824;

type CourseRow = {
  digest: string;
  sectionCount: number;
  missingDescription: boolean;
};

export type ManifestSummary = {
  ok: number;
  empty: number;
  failed: number;
  partial: number;
};

export type TermRefreshDelta = {
  term: string;
  status: 'added' | 'removed' | 'changed' | 'unchanged';
  courses: {
    before: number;
    after: number;
    added: number;
    removed: number;
    changed: number;
  };
  sections: { before: number; after: number };
  missing_descriptions: number;
  manifest: ManifestSummary | null;
};

export type EtlRefreshReport = {
  generated_at: string;
  terms: TermRefreshDelta[];
  totals: {
    terms_changed: number;
    courses_added: number;
    courses_removed: number;
    courses_changed: number;
  };
};

/** Preserve a directory tree so the post-refresh diff has a before-state. */
export async function captureCatalogState(
  sourceDirectory: string,
  destinationDirectory: string,
): Promise<void> {
  await mkdir(destinationDirectory, { recursive: true });
  await cp(sourceDirectory, destinationDirectory, { recursive: true });
}

async function listTermFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  return entries
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/u, ''))
    .sort();
}

async function readTermCourses(
  connection: DuckDBConnection,
  filePath: string,
): Promise<Map<string, CourseRow>> {
  const reader = await connection.runAndReadAll(
    `
    WITH document AS (
      SELECT json FROM read_json(?, format = 'unstructured', records = false,
        maximum_object_size = ${MAX_OBJECT_SIZE})
    ),
    courses AS (
      SELECT unnest(cast(json_extract(json, '$.courses') AS JSON[])) AS course
      FROM document
    )
    SELECT
      json_extract_string(course, '$.course_id') AS course_id,
      md5(course::VARCHAR) AS digest,
      cast(json_array_length(course, '$.sections') AS INTEGER)
        AS section_count,
      coalesce(json_extract_string(course, '$.description'), '')
        IN ('', 'No description available.', 'No description available')
        AS missing_description
    FROM courses
    `,
    [filePath],
  );
  const rows = new Map<string, CourseRow>();
  for (const row of reader.getRowObjects()) {
    rows.set(String(row.course_id), {
      digest: String(row.digest),
      sectionCount: Number(row.section_count),
      missingDescription: Boolean(row.missing_description),
    });
  }
  return rows;
}

function sumSections(rows: Map<string, CourseRow>): number {
  let total = 0;
  for (const row of rows.values()) total += row.sectionCount;
  return total;
}

function countMissingDescriptions(rows: Map<string, CourseRow>): number {
  let total = 0;
  for (const row of rows.values()) if (row.missingDescription) total += 1;
  return total;
}

export type BuildRefreshReportOptions = {
  beforePublicDirectory: string;
  afterPublicDirectory: string;
  generatedAt: string;
  /** Import Manifest summaries for the terms this run published. */
  manifestSummaries: { [term: string]: ManifestSummary };
};

/** Diff the preserved before-state against the refreshed published files. */
export async function buildRefreshReport(
  options: BuildRefreshReportOptions,
): Promise<EtlRefreshReport> {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  try {
    const beforeTerms = await listTermFiles(options.beforePublicDirectory);
    const afterTerms = await listTermFiles(options.afterPublicDirectory);
    const terms = [...new Set([...beforeTerms, ...afterTerms])].sort();

    const deltas: TermRefreshDelta[] = [];
    for (const term of terms) {
      const before = beforeTerms.includes(term)
        ? await readTermCourses(
            connection,
            join(options.beforePublicDirectory, `${term}.json`),
          )
        : new Map<string, CourseRow>();
      const after = afterTerms.includes(term)
        ? await readTermCourses(
            connection,
            join(options.afterPublicDirectory, `${term}.json`),
          )
        : new Map<string, CourseRow>();

      let added = 0;
      let changed = 0;
      for (const [courseId, row] of after) {
        const previous = before.get(courseId);
        if (!previous) added += 1;
        else if (previous.digest !== row.digest) changed += 1;
      }
      let removed = 0;
      for (const courseId of before.keys())
        if (!after.has(courseId)) removed += 1;

      const status: TermRefreshDelta['status'] =
        before.size === 0
          ? 'added'
          : after.size === 0
            ? 'removed'
            : added + removed + changed > 0
              ? 'changed'
              : 'unchanged';

      deltas.push({
        term,
        status,
        courses: {
          before: before.size,
          after: after.size,
          added,
          removed,
          changed,
        },
        sections: { before: sumSections(before), after: sumSections(after) },
        missing_descriptions: countMissingDescriptions(after),
        manifest: options.manifestSummaries[term] ?? null,
      });
    }

    return {
      generated_at: options.generatedAt,
      terms: deltas,
      totals: {
        terms_changed: deltas.filter((delta) => delta.status !== 'unchanged')
          .length,
        courses_added: deltas.reduce(
          (total, delta) => total + delta.courses.added,
          0,
        ),
        courses_removed: deltas.reduce(
          (total, delta) => total + delta.courses.removed,
          0,
        ),
        courses_changed: deltas.reduce(
          (total, delta) => total + delta.courses.changed,
          0,
        ),
      },
    };
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

function manifestCell(summary: ManifestSummary | null): string {
  if (!summary) return '-';
  return `${summary.ok}/${summary.empty}/${summary.failed}/${summary.partial}`;
}

/** Human summary suitable as commit-message and PR-description material. */
export function renderRefreshReportMarkdown(report: EtlRefreshReport): string {
  const lines = [
    `# ETL Refresh Report`,
    ``,
    `Generated: ${report.generated_at}`,
    ``,
    `Totals: ${report.totals.terms_changed} terms changed, ` +
      `+${report.totals.courses_added}/-${report.totals.courses_removed} courses, ` +
      `${report.totals.courses_changed} courses changed in place.`,
    ``,
    `| Term | Status | Courses | +/- | Changed | Sections | Missing desc | Manifest ok/empty/failed/partial |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- |`,
  ];
  for (const delta of report.terms) {
    lines.push(
      `| ${delta.term} | ${delta.status} ` +
        `| ${delta.courses.before} -> ${delta.courses.after} ` +
        `| +${delta.courses.added}/-${delta.courses.removed} ` +
        `| ${delta.courses.changed} ` +
        `| ${delta.sections.before} -> ${delta.sections.after} ` +
        `| ${delta.missing_descriptions} ` +
        `| ${manifestCell(delta.manifest)} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Write the report pair (JSON + Markdown) into the run's report directory. */
export async function writeRefreshReport(
  report: EtlRefreshReport,
  directory: string,
): Promise<{ jsonPath: string; markdownPath: string }> {
  await mkdir(directory, { recursive: true });
  const jsonPath = join(directory, 'refresh-report.json');
  const markdownPath = join(directory, 'refresh-report.md');
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdownPath, renderRefreshReportMarkdown(report));
  return { jsonPath, markdownPath };
}
