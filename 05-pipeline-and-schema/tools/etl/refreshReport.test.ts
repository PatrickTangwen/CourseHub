import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildRefreshReport,
  captureCatalogState,
  renderRefreshReportMarkdown,
  writeRefreshReport,
} from './refreshReport';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function course(
  courseId: string,
  options: { description?: string | null; sections?: number; marker?: string },
) {
  return {
    course_id: courseId,
    description: options.description ?? `${courseId} description`,
    marker: options.marker ?? 'v1',
    sections: Array.from({ length: options.sections ?? 1 }, (_, index) => ({
      section_code: `A0${index}`,
    })),
  };
}

async function writeTerm(
  directory: string,
  term: string,
  courses: unknown[],
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${term}.json`),
    JSON.stringify({ active_planning_term: term, courses }, null, 2),
  );
}

describe('buildRefreshReport', () => {
  it('reports added, removed, and changed courses per term', async () => {
    const root = await mkdtemp(join(tmpdir(), 'etl-report-'));
    tempDirectories.push(root);
    const beforeDirectory = join(root, 'before');
    const afterDirectory = join(root, 'after');

    await writeTerm(beforeDirectory, 'S126', [
      course('CSE:101', { sections: 1 }),
      course('MATH:20A', { description: null }),
    ]);
    await writeTerm(afterDirectory, 'S126', [
      course('CSE:101', { sections: 2, marker: 'v2' }),
      course('PHYS:2A', { description: 'No description available.' }),
    ]);
    await writeTerm(beforeDirectory, 'OLD1', [course('OLD:1', {})]);
    await writeTerm(afterDirectory, 'FA26', [course('CSE:250A', {})]);
    await writeTerm(beforeDirectory, 'SAME', [course('SAME:1', {})]);
    await writeTerm(afterDirectory, 'SAME', [course('SAME:1', {})]);

    const report = await buildRefreshReport({
      beforePublicDirectory: beforeDirectory,
      afterPublicDirectory: afterDirectory,
      generatedAt: '2026-08-05T12:00:00.000Z',
      manifestSummaries: {
        S126: { ok: 3, empty: 1, failed: 0, partial: 0 },
      },
    });

    expect(report.terms.map((delta) => [delta.term, delta.status])).toEqual([
      ['FA26', 'added'],
      ['OLD1', 'removed'],
      ['S126', 'changed'],
      ['SAME', 'unchanged'],
    ]);

    const s126 = report.terms.find((delta) => delta.term === 'S126')!;
    expect(s126.courses).toEqual({
      before: 2,
      after: 2,
      added: 1,
      removed: 1,
      changed: 1,
    });
    expect(s126.sections).toEqual({ before: 2, after: 3 });
    expect(s126.missing_descriptions).toBe(1);
    expect(s126.manifest).toEqual({ ok: 3, empty: 1, failed: 0, partial: 0 });

    expect(report.totals).toEqual({
      terms_changed: 3,
      courses_added: 2,
      courses_removed: 2,
      courses_changed: 1,
    });

    const markdown = renderRefreshReportMarkdown(report);
    expect(markdown).toContain('| S126 | changed | 2 -> 2 | +1/-1 | 1 |');
    expect(markdown).toContain('| 3/1/0/0 |');

    const written = await writeRefreshReport(report, join(root, 'out'));
    expect(JSON.parse(await readFile(written.jsonPath, 'utf-8'))).toEqual(
      report,
    );
    await expect(readFile(written.markdownPath, 'utf-8')).resolves.toContain(
      '# ETL Refresh Report',
    );
  }, 30_000);

  it('captures a before-state copy that later diffs cleanly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'etl-capture-'));
    tempDirectories.push(root);
    const publicDirectory = join(root, 'public');
    await writeTerm(publicDirectory, 'SP26', [course('CSE:101', {})]);

    const beforeDirectory = join(root, 'preserved');
    await captureCatalogState(publicDirectory, beforeDirectory);

    const report = await buildRefreshReport({
      beforePublicDirectory: beforeDirectory,
      afterPublicDirectory: publicDirectory,
      generatedAt: '2026-08-05T12:00:00.000Z',
      manifestSummaries: {},
    });
    expect(report.terms).toHaveLength(1);
    expect(report.terms[0]!.status).toBe('unchanged');
    expect(report.totals.terms_changed).toBe(0);
  }, 30_000);
});
