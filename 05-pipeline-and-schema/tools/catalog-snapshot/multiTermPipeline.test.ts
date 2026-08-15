import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogSnapshot, CatalogSnapshotConfig } from './catalogSnapshot';
import { runMultiTermSnapshotPipeline } from './multiTermPipeline';
import type { PublishedSnapshotSourceLoaders } from './publishedSnapshotPipeline';
import { createObjectSnapshotStorage } from './snapshotStorage';
import type { SupportedTermRegistry } from './supportedTermRegistry';

const generatedAt = '2026-06-26T12:00:00.000Z';

function makeConfig(rootDir: string): CatalogSnapshotConfig {
  return {
    active_planning_term: 'SP26',
    term_label: 'Spring 2026',
    term_date_range: { start: '2026-03-30', end: '2026-06-12' },
    configured_subjects: ['CSE', 'MATH'],
    paths: {
      raw_dir: join(rootDir, 'raw'),
      normalized_dir: join(rootDir, 'normalized'),
      reports_dir: join(rootDir, 'reports'),
      public_catalog_dir: join(rootDir, 'public'),
      metadata_path: join(rootDir, 'metadata.json'),
    },
  };
}

function courseNumber(subject: string): string {
  if (subject === 'CSE') return '101';
  if (subject === 'MATH') return '20A';
  return '1';
}

function makeScheduleCourse(
  subject: string,
  term: string,
): CatalogSnapshot['courses'][number] {
  const number = courseNumber(subject);
  const id = `${subject}:${number}`;
  return {
    course_id: id,
    subject,
    course_number: number,
    title: `${subject} Schedule Title`,
    units: '4',
    description: null,
    prerequisites_text: null,
    restrictions_text: null,
    catalog_url: null,
    archive_avg_gpa: null,
    archive_record_count: 0,
    grade_archive_records: [],
    ge_matches: [],
    sections: [
      {
        section_id: `${term}:${subject}-section`,
        course_id: id,
        section_code: 'A00',
        meeting_type: 'Lecture',
        instructors: [`${subject} Instructor`],
        meetings: [
          {
            date: null,
            days: ['Monday'],
            start_time: '09:00',
            end_time: '09:50',
            building: 'CENTR',
            room: '101',
            is_tba: false,
            meeting_type: 'Lecture',
            raw_days: 'M',
            raw_time: '9:00a-9:50a',
            raw_location: 'CENTR 101',
          },
        ],
        enrolled: 80,
        capacity: 100,
        waitlist_count: 0,
        raw: { source: 'fixture' },
      },
    ],
  };
}

type Counters = {
  schedule: string[];
  generalCatalog: string[];
  gradeArchive: string[];
};

function makeCountingLoaders(
  counters: Counters,
): PublishedSnapshotSourceLoaders {
  return {
    scheduleOfClasses(subject, context) {
      const term = context.config.active_planning_term;
      counters.schedule.push(`${term}:${subject}`);
      return {
        subject,
        fetched_at: context.generatedAt,
        raw_files: [
          { filename: `${subject}.html`, contents: `<html>${subject}</html>` },
        ],
        parse() {
          return {
            source_timestamp: `schedule timestamp ${subject}`,
            data: {
              subject,
              term,
              source_url: `https://schedule.test/${subject}`,
              fetched_at: context.generatedAt,
              source_timestamp: `schedule timestamp ${subject}`,
              courses: [makeScheduleCourse(subject, term)],
            },
          };
        },
      };
    },
    generalCatalog(subject, context) {
      counters.generalCatalog.push(subject);
      return {
        subject,
        fetched_at: context.generatedAt,
        raw_files: [
          { filename: `${subject}.html`, contents: `<html>${subject}</html>` },
        ],
        parse() {
          return {
            source_timestamp: context.generatedAt,
            data: [
              {
                course_id: `${subject}:${courseNumber(subject)}`,
                subject,
                course_number: courseNumber(subject),
                title: `${subject} Catalog Title`,
                units: '4',
                description: `${subject} Catalog Description`,
                prerequisites_text: null,
                restrictions_text: null,
                catalog_url: `https://catalog.test/${subject}`,
              },
            ],
          };
        },
      };
    },
    instructorGradeArchive(subject, context) {
      counters.gradeArchive.push(subject);
      return {
        subject,
        fetched_at: context.generatedAt,
        raw_files: [
          { filename: `${subject}.html`, contents: `<html>${subject}</html>` },
        ],
        parse() {
          return { source_timestamp: context.generatedAt, data: [] };
        },
      };
    },
  };
}

describe('Multi-term snapshot pipeline', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function makeTempConfig() {
    const dir = await mkdtemp(join(tmpdir(), 'multi-term-'));
    tempDirs.push(dir);
    return makeConfig(dir);
  }

  it('publishes one snapshot per term and a single Supported Term registry', async () => {
    const config = await makeTempConfig();
    const counters: Counters = {
      schedule: [],
      generalCatalog: [],
      gradeArchive: [],
    };

    await runMultiTermSnapshotPipeline(config, {
      runId: 'multi-run',
      generatedAt,
      terms: [
        { term: 'FA25', label: 'Fall 2025' },
        { term: 'SP26', label: 'Spring 2026' },
      ],
      sourceLoaders: makeCountingLoaders(counters),
      fetchDelayMs: 0,
    });

    const fa25 = JSON.parse(
      await readFile(
        join(config.paths.public_catalog_dir, 'FA25.json'),
        'utf-8',
      ),
    ) as CatalogSnapshot;
    const sp26 = JSON.parse(
      await readFile(
        join(config.paths.public_catalog_dir, 'SP26.json'),
        'utf-8',
      ),
    ) as CatalogSnapshot;

    expect(fa25.active_planning_term).toBe('FA25');
    expect(fa25.term_label).toBe('Fall 2025');
    expect(fa25.courses.map((course) => course.course_id).sort()).toEqual([
      'CSE:101',
      'MATH:20A',
    ]);
    expect(fa25.courses[0]!.sections[0]!.section_id).toMatch(/^FA25:/u);
    expect(sp26.active_planning_term).toBe('SP26');
    expect(sp26.courses[0]!.sections[0]!.section_id).toMatch(/^SP26:/u);

    const registry = JSON.parse(
      await readFile(config.paths.metadata_path, 'utf-8'),
    ) as SupportedTermRegistry;

    expect(registry.last_update).toBe(generatedAt);
    expect(registry.terms).toEqual([
      {
        term: 'FA25',
        label: 'Fall 2025',
        date_range: null,
        frozen: false,
        generated_at: generatedAt,
        snapshot_path: 'catalogs/public/FA25.json',
        manifest_path: 'catalogs/import-manifests/FA25.json',
      },
      {
        term: 'SP26',
        label: 'Spring 2026',
        date_range: { start: '2026-03-30', end: '2026-06-12' },
        frozen: false,
        generated_at: generatedAt,
        snapshot_path: 'catalogs/public/SP26.json',
        manifest_path: 'catalogs/import-manifests/SP26.json',
      },
    ]);
    await expect(
      readFile(
        join(config.paths.public_catalog_dir, '../import-manifests/FA25.json'),
        'utf-8',
      ),
    ).resolves.toContain('"active_planning_term": "FA25"');
    await expect(
      readFile(
        join(config.paths.public_catalog_dir, '../import-manifests/SP26.json'),
        'utf-8',
      ),
    ).resolves.toContain('"active_planning_term": "SP26"');
  });

  it('fetches term-agnostic sources once per subject, schedule per term', async () => {
    const config = await makeTempConfig();
    const counters: Counters = {
      schedule: [],
      generalCatalog: [],
      gradeArchive: [],
    };

    await runMultiTermSnapshotPipeline(config, {
      runId: 'multi-run',
      generatedAt,
      terms: [
        { term: 'FA25', label: 'Fall 2025' },
        { term: 'SP26', label: 'Spring 2026' },
      ],
      sourceLoaders: makeCountingLoaders(counters),
      fetchDelayMs: 0,
    });

    // Schedule of Classes is term-specific: 2 terms x 2 subjects.
    expect(counters.schedule.sort()).toEqual([
      'FA25:CSE',
      'FA25:MATH',
      'SP26:CSE',
      'SP26:MATH',
    ]);
    // Term-agnostic sources fetched once per subject across both terms.
    expect(counters.generalCatalog.sort()).toEqual(['CSE', 'MATH']);
    expect(counters.gradeArchive.sort()).toEqual(['CSE', 'MATH']);
  });

  it('uses configured date ranges for every published term', async () => {
    const config = await makeTempConfig();
    config.term_date_ranges = {
      SP26: { start: '2026-03-30', end: '2026-06-12' },
      S126: { start: '2026-06-29', end: '2026-08-01' },
      S226: { start: '2026-08-03', end: '2026-09-05' },
    };

    await runMultiTermSnapshotPipeline(config, {
      runId: 'multi-run',
      generatedAt,
      terms: [
        { term: 'SP26', label: 'Spring 2026' },
        { term: 'S126', label: 'Summer Session I 2026' },
        { term: 'S226', label: 'Summer Session II 2026' },
      ],
      sourceLoaders: makeCountingLoaders({
        schedule: [],
        generalCatalog: [],
        gradeArchive: [],
      }),
      fetchDelayMs: 0,
    });

    const s126 = JSON.parse(
      await readFile(
        join(config.paths.public_catalog_dir, 'S126.json'),
        'utf-8',
      ),
    ) as CatalogSnapshot;
    const registry = JSON.parse(
      await readFile(config.paths.metadata_path, 'utf-8'),
    ) as SupportedTermRegistry;

    expect(s126.term_date_range).toEqual({
      start: '2026-06-29',
      end: '2026-08-01',
    });
    expect(registry.terms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          term: 'S126',
          date_range: { start: '2026-06-29', end: '2026-08-01' },
        }),
        expect.objectContaining({
          term: 'S226',
          date_range: { start: '2026-08-03', end: '2026-09-05' },
        }),
      ]),
    );
  });

  it('publishes registry when an old single-term metadata file exists', async () => {
    const config = await makeTempConfig();
    await writeFile(
      config.paths.metadata_path,
      JSON.stringify({ last_update: '2026-06-01T00:00:00.000Z' }),
      'utf-8',
    );

    await runMultiTermSnapshotPipeline(config, {
      runId: 'multi-run',
      generatedAt,
      terms: [{ term: 'SP26', label: 'Spring 2026' }],
      sourceLoaders: makeCountingLoaders({
        schedule: [],
        generalCatalog: [],
        gradeArchive: [],
      }),
      fetchDelayMs: 0,
    });

    const registry = JSON.parse(
      await readFile(config.paths.metadata_path, 'utf-8'),
    ) as SupportedTermRegistry;

    expect(registry.terms).toEqual([
      expect.objectContaining({
        term: 'SP26',
        frozen: false,
      }),
    ]);
  });

  it('uses each term discovered subject list instead of configured subjects', async () => {
    const config = await makeTempConfig();
    const counters: Counters = {
      schedule: [],
      generalCatalog: [],
      gradeArchive: [],
    };

    await runMultiTermSnapshotPipeline(config, {
      runId: 'multi-run',
      generatedAt,
      terms: [
        { term: 'FA25', label: 'Fall 2025', subjects: ['CSE'] },
        {
          term: 'SP26',
          label: 'Spring 2026',
          subjects: ['CSE', 'MATH', 'VIS'],
        },
      ],
      sourceLoaders: makeCountingLoaders(counters),
      fetchDelayMs: 0,
    });

    const fa25 = JSON.parse(
      await readFile(
        join(config.paths.public_catalog_dir, 'FA25.json'),
        'utf-8',
      ),
    ) as CatalogSnapshot;
    const sp26Manifest = JSON.parse(
      await readFile(
        join(config.paths.public_catalog_dir, '../import-manifests/SP26.json'),
        'utf-8',
      ),
    ) as { configured_subjects: string[] };

    expect(fa25.configured_subjects).toEqual(['CSE']);
    expect(sp26Manifest.configured_subjects).toEqual(['CSE', 'MATH', 'VIS']);
    expect(counters.schedule.sort()).toEqual([
      'FA25:CSE',
      'SP26:CSE',
      'SP26:MATH',
      'SP26:VIS',
    ]);
    expect(counters.generalCatalog.sort()).toEqual(['CSE', 'MATH', 'VIS']);
    expect(counters.gradeArchive.sort()).toEqual(['CSE', 'MATH', 'VIS']);
  });

  it('retains terms that leave the window as frozen snapshots in injected storage', async () => {
    const config = await makeTempConfig();
    const objects = new Map<string, string>();
    const storage = createObjectSnapshotStorage({
      getObject(key) {
        return Promise.resolve(objects.get(key) ?? null);
      },
      putObject(key, body) {
        objects.set(key, body);
        return Promise.resolve();
      },
    });
    const counters: Counters = {
      schedule: [],
      generalCatalog: [],
      gradeArchive: [],
    };

    await runMultiTermSnapshotPipeline(config, {
      runId: 'multi-run-one',
      generatedAt,
      terms: [
        { term: 'FA25', label: 'Fall 2025' },
        { term: 'SP26', label: 'Spring 2026' },
      ],
      sourceLoaders: makeCountingLoaders(counters),
      fetchDelayMs: 0,
      storage,
    });
    const frozenSnapshotPath = join(
      config.paths.public_catalog_dir,
      'FA25.json',
    );
    const firstFa25Snapshot = objects.get(frozenSnapshotPath);
    expect(firstFa25Snapshot).toContain('"active_planning_term": "FA25"');
    await expect(
      readFile(
        join(
          config.paths.raw_dir,
          'multi-run-one-FA25/schedule_of_classes/CSE.html',
        ),
        'utf-8',
      ),
    ).resolves.toContain('CSE');
    await expect(
      readFile(
        join(
          config.paths.normalized_dir,
          'multi-run-one-FA25/schedule_of_classes/CSE.json',
        ),
        'utf-8',
      ),
    ).resolves.toContain('"subject": "CSE"');

    counters.schedule = [];
    counters.generalCatalog = [];
    counters.gradeArchive = [];

    await runMultiTermSnapshotPipeline(config, {
      runId: 'multi-run-two',
      generatedAt: '2026-07-01T12:00:00.000Z',
      terms: [{ term: 'SP26', label: 'Spring 2026' }],
      sourceLoaders: makeCountingLoaders(counters),
      fetchDelayMs: 0,
      storage,
    });

    const registry = JSON.parse(
      objects.get(config.paths.metadata_path) ?? '{}',
    ) as SupportedTermRegistry;

    expect(objects.get(frozenSnapshotPath)).toBe(firstFa25Snapshot);
    expect(counters.schedule).toEqual(['SP26:CSE', 'SP26:MATH']);
    expect(registry.terms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          term: 'FA25',
          label: 'Fall 2025',
          frozen: true,
          generated_at: generatedAt,
          snapshot_path: 'catalogs/public/FA25.json',
        }),
        expect.objectContaining({
          term: 'SP26',
          label: 'Spring 2026',
          frozen: false,
          generated_at: '2026-07-01T12:00:00.000Z',
        }),
      ]),
    );
    expect([...objects.keys()]).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('/raw/'),
        expect.stringContaining('/normalized/'),
        expect.stringContaining('/reports/'),
      ]),
    );
  });
});
