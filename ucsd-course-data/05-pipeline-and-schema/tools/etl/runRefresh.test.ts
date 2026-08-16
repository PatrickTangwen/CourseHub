import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runEtlRefresh } from './runRefresh';
import type {
  CatalogSnapshot,
  CatalogSnapshotConfig,
} from '../catalog-snapshot/catalogSnapshot';
import type { PublishedSnapshotSourceLoaders } from '../catalog-snapshot/publishedSnapshotPipeline';
import type { SupportedTermRegistry } from '../catalog-snapshot/supportedTermRegistry';

const generatedAt = '2026-08-05T12:00:00.000Z';
const plannerBaseUrl = 'https://planner.test/api/v1';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function makeConfig(): Promise<CatalogSnapshotConfig> {
  const root = await mkdtemp(join(tmpdir(), 'etl-refresh-'));
  tempDirectories.push(root);
  const config: CatalogSnapshotConfig = {
    active_planning_term: 'SP26',
    term_label: 'Spring 2026',
    term_date_range: { start: '2026-03-30', end: '2026-06-12' },
    term_date_ranges: {
      FA26: { start: '2026-09-24', end: '2026-12-12' },
    },
    configured_subjects: ['CSE'],
    paths: {
      raw_dir: join(root, 'raw'),
      normalized_dir: join(root, 'normalized'),
      reports_dir: join(root, 'reports'),
      public_catalog_dir: join(root, 'public'),
      metadata_path: join(root, 'metadata.json'),
    },
  };
  await mkdir(config.paths.public_catalog_dir, { recursive: true });
  return config;
}

function makeLoaders(): PublishedSnapshotSourceLoaders {
  return {
    scheduleOfClasses(subject, context) {
      const term = context.config.active_planning_term;
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
              courses: [
                {
                  course_id: `${subject}:101`,
                  subject,
                  course_number: '101',
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
                      course_id: `${subject}:101`,
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
                } as CatalogSnapshot['courses'][number],
              ],
            },
          };
        },
      };
    },
    generalCatalog(subject, context) {
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
                course_id: `${subject}:101`,
                subject,
                course_number: '101',
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

function plannerCourse() {
  return {
    module_code: 'CSE-250A',
    module_name: 'Probabilistic Reasoning',
    sections: [
      {
        section_id: 'E 00000001',
        section_ref: 'REF-1',
        section_code: '001-000-LE',
        instruction_type_name: 'Lecture',
        status: null,
        event_package_ids: ['pkg-1'],
        instructors: ['Instructor A'],
        capacity: 100,
        enrolled: 50,
        seats_available: 50,
        waitlist_capacity: null,
        waitlist_enrolled: null,
        waitlist_available: null,
        meetings: [
          {
            meeting_kind: 'class',
            specific_date: null,
            day_code: 'M',
            start_time_display: '09:00am',
            end_time_display: '09:50am',
            building_code: 'CENTR',
            room_code: 'CENTR 101',
            is_remote: false,
            is_tba: false,
          },
        ],
      },
    ],
  };
}

function makePlannerFetch(options: { plannerTermCode: string }): typeof fetch {
  const plannerTerms = {
    terms: [
      {
        term_code: options.plannerTermCode,
        term_name: null,
        calendar_year: null,
        course_count: 1,
        section_count: 1,
        meeting_count: 1,
        last_full_refresh_at: '2026-08-02 11:24:07+00',
        configured: true,
      },
    ],
  };
  return ((input: string | URL) => {
    const url = String(input);
    if (url === `${plannerBaseUrl}/planner/terms`)
      return Promise.resolve(Response.json(plannerTerms));
    if (url.startsWith(`${plannerBaseUrl}/catalog/filters`))
      return Promise.resolve(Response.json({ subjects: [{ value: 'CSE' }] }));
    if (url.startsWith(`${plannerBaseUrl}/catalog/courses`)) {
      return Promise.resolve(
        Response.json({
          term_code: options.plannerTermCode,
          total: 1,
          offset: 0,
          courses: [plannerCourse()],
        }),
      );
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  }) as typeof fetch;
}

describe('runEtlRefresh', () => {
  it('refreshes SoC terms, then Class Planner terms, and reports the diff', async () => {
    const config = await makeConfig();
    const supportedTermsPath = join(
      config.paths.reports_dir,
      'supported-terms.json',
    );
    const validatorCalls: string[] = [];

    const result = await runEtlRefresh({
      config,
      generatedAt,
      terms: [{ term: 'SP26', label: 'Spring 2026' }],
      sourceLoaders: makeLoaders(),
      fetch: makePlannerFetch({ plannerTermCode: 'FA26' }),
      classplannerBaseUrl: plannerBaseUrl,
      classplannerRequestDelayMs: 0,
      supportedTermsPath,
      runValidators() {
        validatorCalls.push('validated');
        return Promise.resolve();
      },
      log() {},
    });

    expect(result.scheduleOfClassesTerms).toEqual(['SP26']);
    expect(result.classplannerTerms).toEqual(['FA26']);
    expect(validatorCalls).toEqual(['validated']);

    const sp26 = JSON.parse(
      await readFile(
        join(config.paths.public_catalog_dir, 'SP26.json'),
        'utf-8',
      ),
    ) as CatalogSnapshot;
    expect(sp26.courses.map((course) => course.course_id)).toEqual(['CSE:101']);

    const fa26 = JSON.parse(
      await readFile(
        join(config.paths.public_catalog_dir, 'FA26.json'),
        'utf-8',
      ),
    ) as CatalogSnapshot;
    expect(fa26.active_planning_term).toBe('FA26');
    expect(fa26.courses.map((course) => course.course_id)).toEqual([
      'CSE:250A',
    ]);
    // The Class Planner republish must leave FA26 active, not frozen.
    const registry = JSON.parse(
      await readFile(config.paths.metadata_path, 'utf-8'),
    ) as SupportedTermRegistry;
    const registryByTerm = Object.fromEntries(
      registry.terms.map((entry) => [entry.term, entry.frozen]),
    );
    expect(registryByTerm).toEqual({ SP26: false, FA26: false });

    expect(result.supportedTerms.sort()).toEqual(['FA26', 'SP26']);
    expect(JSON.parse(await readFile(supportedTermsPath, 'utf-8'))).toEqual(
      result.supportedTerms,
    );

    const deltas = Object.fromEntries(
      result.report.terms.map((delta) => [delta.term, delta.status]),
    );
    expect(deltas).toEqual({ SP26: 'added', FA26: 'added' });
    expect(result.report.terms.every((delta) => delta.manifest !== null)).toBe(
      true,
    );
    await expect(
      readFile(result.reportPaths.markdownPath, 'utf-8'),
    ).resolves.toContain('# ETL Refresh Report');

    // Raw planner pages are preserved before conversion.
    const rawRuns = await readdir(
      join(config.paths.raw_dir, 'classplanner', 'FA26'),
    );
    expect(rawRuns).toHaveLength(1);
    await expect(
      readdir(join(config.paths.raw_dir, 'classplanner', 'FA26', rawRuns[0]!)),
    ).resolves.toEqual(
      expect.arrayContaining(['courses.json', 'pages', 'terms.json', 'tss']),
    );
  }, 60_000);

  it('aborts before mutating anything when a term is served by both sources', async () => {
    const config = await makeConfig();
    const validatorCalls: string[] = [];

    await expect(
      runEtlRefresh({
        config,
        generatedAt,
        terms: [{ term: 'SP26', label: 'Spring 2026' }],
        sourceLoaders: makeLoaders(),
        fetch: makePlannerFetch({ plannerTermCode: 'SP26' }),
        classplannerBaseUrl: plannerBaseUrl,
        runValidators() {
          validatorCalls.push('validated');
          return Promise.resolve();
        },
        log() {},
      }),
    ).rejects.toThrow(/SP26.*Decide the schedule source/su);

    expect(validatorCalls).toEqual([]);
    await expect(readdir(config.paths.public_catalog_dir)).resolves.toEqual([]);
  }, 60_000);
});
