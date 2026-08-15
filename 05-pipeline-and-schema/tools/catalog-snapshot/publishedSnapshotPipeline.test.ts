import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildTracerCatalogSnapshot,
  publishCatalogSnapshot,
  type CatalogSnapshot,
  type CatalogSnapshotConfig,
} from './catalogSnapshot';
import {
  runPublishedSnapshotPipeline,
  type PublishedSnapshotSourceLoaders,
} from './publishedSnapshotPipeline';

const generatedAt = '2026-06-19T12:00:00.000Z';

function makeConfig(rootDir: string): CatalogSnapshotConfig {
  return {
    active_planning_term: 'FA26',
    term_label: 'Fall 2026',
    term_date_range: {
      start: '2026-09-24',
      end: '2026-12-12',
    },
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
  if (subject === 'BIPN') return '156';
  return subject === 'CSE' ? '101' : '20A';
}

function courseId(subject: string): string {
  return `${subject}:${courseNumber(subject)}`;
}

function makeScheduleCourse(
  subject: string,
  options: {
    unsafeRaw?: boolean;
    catalogUrl?: string | null;
  } = {},
): CatalogSnapshot['courses'][number] {
  const number = courseNumber(subject);
  const id = courseId(subject);
  return {
    course_id: id,
    subject,
    course_number: number,
    title: `${subject} Schedule Title`,
    units: '4',
    description: null,
    prerequisites_text: null,
    restrictions_text: null,
    catalog_url: options.catalogUrl ?? null,
    archive_avg_gpa: null,
    archive_record_count: 0,
    grade_archive_records: [],
    ge_matches: [],
    sections: [
      {
        section_id: `FA26:${subject}-section`,
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
        raw: options.unsafeRaw
          ? {
              source: 'fixture',
              waitlist: 2,
            }
          : {
              source: 'fixture',
            },
      },
    ],
  };
}

function makeSourceLoaders(
  options: {
    failScheduleSubject?: string;
    failScheduleParseSubjects?: string[];
    emptyScheduleSubjects?: string[];
    unsafeScheduleRaw?: boolean;
    generalCatalogPages?: string[];
  } = {},
): PublishedSnapshotSourceLoaders {
  return {
    scheduleOfClasses(subject, context) {
      if (subject === options.failScheduleSubject)
        throw new Error(`Schedule subject ${subject} is unavailable`);
      return {
        subject,
        fetched_at: context.generatedAt,
        raw_files: [
          {
            filename: `${subject}.html`,
            contents: `<html>${subject} schedule</html>`,
          },
        ],
        parse() {
          if (options.failScheduleParseSubjects?.includes(subject))
            throw new Error(`Schedule parser failed for ${subject}`);
          return {
            source_timestamp: `schedule timestamp ${subject}`,
            data: {
              subject,
              term: context.config.active_planning_term,
              source_url: `https://schedule.test/${subject}`,
              fetched_at: context.generatedAt,
              source_timestamp: `schedule timestamp ${subject}`,
              courses: options.emptyScheduleSubjects?.includes(subject)
                ? []
                : [
                    makeScheduleCourse(subject, {
                      catalogUrl:
                        subject === 'BIPN'
                          ? 'https://catalog.ucsd.edu/courses/BIOL.html#bipn156'
                          : null,
                      unsafeRaw: options.unsafeScheduleRaw && subject === 'CSE',
                    }),
                  ],
            },
          };
        },
      };
    },
    generalCatalog(subject, context) {
      options.generalCatalogPages?.push(
        context.catalogPageBySubject?.[subject] ?? subject,
      );
      return {
        subject,
        fetched_at: context.generatedAt,
        raw_files: [
          {
            filename: `${subject}.html`,
            contents: `<html>${subject} catalog</html>`,
          },
        ],
        parse() {
          return {
            source_timestamp: context.generatedAt,
            data: [
              {
                course_id: courseId(subject),
                subject,
                course_number: courseNumber(subject),
                title: `${subject} Catalog Title`,
                units: '4',
                description: `${subject} Catalog Description`,
                prerequisites_text: `${subject} prerequisite text`,
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
          {
            filename: `${subject}.html`,
            contents: `<html>${subject} grades</html>`,
          },
        ],
        parse() {
          return {
            source_timestamp: context.generatedAt,
            data: [
              {
                subject,
                course: courseNumber(subject),
                year: '2025',
                quarter: 'FA',
                title: `${subject} Catalog Title`,
                instructor: `${subject} Instructor`,
                gpa: subject === 'CSE' ? 3.5 : 3.75,
                a: 50,
                b: 30,
                c: 10,
                d: 5,
                f: 1,
                w: 4,
                p: 0,
                np: 0,
                raw: {
                  Subject: subject,
                  Course: courseNumber(subject),
                  Year: '2025',
                  Quarter: 'FA',
                  Title: `${subject} Catalog Title`,
                  Instructor: `${subject} Instructor`,
                  GPA: subject === 'CSE' ? '3.50' : '3.75',
                  A: '50',
                  B: '30',
                  C: '10',
                  D: '5',
                  F: '1',
                  W: '4',
                  P: '0',
                  NP: '0',
                },
              },
            ],
          };
        },
      };
    },
  };
}

describe('Published Snapshot pipeline', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function makeTempConfig() {
    const dir = await mkdtemp(join(tmpdir(), 'published-snapshot-'));
    tempDirs.push(dir);
    return makeConfig(dir);
  }

  it('fetches raw sources, writes normalized artifacts, validates, publishes, and reports a CSE/MATH snapshot', async () => {
    const config = await makeTempConfig();

    const result = await runPublishedSnapshotPipeline(config, {
      runId: 'run-success',
      generatedAt,
      sourceLoaders: makeSourceLoaders(),
    });

    const publishedSnapshot = JSON.parse(
      await readFile(result.snapshotPath, 'utf-8'),
    ) as CatalogSnapshot;
    const report = JSON.parse(
      await readFile(result.reportPath, 'utf-8'),
    ) as typeof result.report;

    expect(publishedSnapshot).toMatchObject({
      run_id: 'run-success',
      active_planning_term: 'FA26',
      configured_subjects: ['CSE', 'MATH'],
      source_timestamps: {
        schedule_of_classes: 'schedule timestamp CSE',
        general_catalog: generatedAt,
        instructor_grade_archive: generatedAt,
      },
      courses: [
        {
          course_id: 'CSE:101',
          title: 'CSE Catalog Title',
          description: 'CSE Catalog Description',
          archive_avg_gpa: 3.5,
          archive_record_count: 1,
          sections: [
            {
              section_id: 'FA26:CSE-section',
            },
          ],
        },
        {
          course_id: 'MATH:20A',
          title: 'MATH Catalog Title',
          archive_avg_gpa: 3.75,
          sections: [
            {
              section_id: 'FA26:MATH-section',
            },
          ],
        },
      ],
    });
    expect(report).toMatchObject({
      run_id: 'run-success',
      status: 'published',
      configured_subjects: ['CSE', 'MATH'],
      validation: {
        success: true,
        errors: [],
      },
      row_counts: {
        schedule_of_classes: {
          courses: 2,
          sections: 2,
          meetings: 2,
        },
        general_catalog: {
          courses: 2,
        },
        instructor_grade_archive: {
          records: 2,
        },
        catalog_snapshot: {
          courses: 2,
          sections: 2,
        },
      },
      parser_errors: [],
      errors: [],
    });
    expect(result.manifest.summary).toEqual({
      ok: 6,
      empty: 0,
      failed: 0,
      partial: 0,
    });
    expect(result.manifest.cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          term: 'FA26',
          subject: 'CSE',
          source: 'schedule_of_classes',
          status: 'ok',
          attempts: 1,
        }),
        expect.objectContaining({
          term: 'FA26',
          subject: 'CSE',
          source: 'instructor_grade_archive',
          status: 'ok',
        }),
      ]),
    );
    await expect(readFile(result.manifestPath, 'utf-8')).resolves.toContain(
      '"active_planning_term": "FA26"',
    );
    await expect(
      readFile(
        join(config.paths.raw_dir, 'run-success/schedule_of_classes/CSE.html'),
        'utf-8',
      ),
    ).resolves.toContain('CSE schedule');
    await expect(
      readFile(
        join(config.paths.raw_dir, 'run-success/general_catalog/MATH.html'),
        'utf-8',
      ),
    ).resolves.toContain('MATH catalog');
    await expect(
      readFile(
        join(
          config.paths.raw_dir,
          'run-success/instructor_grade_archive/CSE.html',
        ),
        'utf-8',
      ),
    ).resolves.toContain('CSE grades');
    await expect(
      readFile(
        join(
          config.paths.normalized_dir,
          'run-success/catalog_snapshot.staging.json',
        ),
        'utf-8',
      ),
    ).resolves.toContain('"run_id": "run-success"');
  });

  it('uses Schedule of Classes catalog links to choose grouped General Catalog pages', async () => {
    const config = await makeTempConfig();
    config.configured_subjects = ['BIPN'];
    const generalCatalogPages: string[] = [];

    const result = await runPublishedSnapshotPipeline(config, {
      runId: 'run-grouped-catalog',
      generatedAt,
      sourceLoaders: makeSourceLoaders({ generalCatalogPages }),
    });

    const publishedSnapshot = JSON.parse(
      await readFile(result.snapshotPath, 'utf-8'),
    ) as CatalogSnapshot;

    expect(generalCatalogPages).toEqual(['BIOL']);
    expect(publishedSnapshot.courses[0]).toMatchObject({
      course_id: 'BIPN:156',
      title: 'BIPN Catalog Title',
      description: 'BIPN Catalog Description',
    });
  });

  it('publishes a partial snapshot and records a persistent cell failure', async () => {
    const config = await makeTempConfig();
    const result = await runPublishedSnapshotPipeline(config, {
      runId: 'run-source-failure',
      generatedAt,
      maxFetchAttempts: 2,
      fetchRetryDelayMs: 0,
      sourceLoaders: makeSourceLoaders({
        failScheduleSubject: 'MATH',
      }),
    });

    const partialSnapshot = JSON.parse(
      await readFile(result.snapshotPath, 'utf-8'),
    ) as CatalogSnapshot;
    const failureReport = JSON.parse(
      await readFile(
        join(config.paths.reports_dir, 'run-source-failure.import-report.json'),
        'utf-8',
      ),
    ) as {
      status?: string;
      errors?: { subject?: string; message?: string; attempts?: number }[];
    };

    expect(partialSnapshot.courses.map((course) => course.subject)).toEqual([
      'CSE',
    ]);
    expect(failureReport.status).toBe('published');
    expect(failureReport.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject: 'MATH',
          message: 'Schedule subject MATH is unavailable',
          attempts: 2,
        }),
      ]),
    );
    expect(result.manifest.summary).toEqual({
      ok: 5,
      empty: 0,
      failed: 1,
      partial: 0,
    });
    expect(result.manifest.cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject: 'MATH',
          source: 'schedule_of_classes',
          status: 'failed',
          attempts: 2,
        }),
      ]),
    );
  });

  it('keeps source loading bounded to one in-flight cell', async () => {
    const config = await makeTempConfig();
    const state = {
      active: 0,
      maxActive: 0,
    };
    const baseLoaders = makeSourceLoaders();

    function bounded<T extends keyof PublishedSnapshotSourceLoaders>(
      key: T,
    ): PublishedSnapshotSourceLoaders[T] {
      return (async (subject, context) => {
        state.active += 1;
        state.maxActive = Math.max(state.maxActive, state.active);
        await Promise.resolve();
        try {
          return await baseLoaders[key](subject, context);
        } finally {
          state.active -= 1;
        }
      }) as PublishedSnapshotSourceLoaders[T];
    }

    await runPublishedSnapshotPipeline(config, {
      runId: 'run-bounded-fetch',
      generatedAt,
      sourceLoaders: {
        scheduleOfClasses: bounded('scheduleOfClasses'),
        generalCatalog: bounded('generalCatalog'),
        instructorGradeArchive: bounded('instructorGradeArchive'),
      },
    });

    expect(state.maxActive).toBe(1);
  });

  it('retries transient fetch failures before recording the cell as ok', async () => {
    const config = await makeTempConfig();
    const attemptsBySubject = new Map<string, number>();
    const loaders = makeSourceLoaders();

    const result = await runPublishedSnapshotPipeline(config, {
      runId: 'run-transient-retry',
      generatedAt,
      maxFetchAttempts: 3,
      fetchRetryDelayMs: 0,
      sourceLoaders: {
        ...loaders,
        scheduleOfClasses(subject, context) {
          const attempts = (attemptsBySubject.get(subject) ?? 0) + 1;
          attemptsBySubject.set(subject, attempts);
          if (subject === 'MATH' && attempts === 1)
            throw new Error('temporary Schedule gateway timeout');
          return loaders.scheduleOfClasses(subject, context);
        },
      },
    });

    expect(attemptsBySubject.get('MATH')).toBe(2);
    expect(result.manifest.cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject: 'MATH',
          source: 'schedule_of_classes',
          status: 'ok',
          attempts: 2,
        }),
      ]),
    );
    expect(result.report.errors).toEqual([]);
  });

  it('records not-offered schedule results as empty without throwing', async () => {
    const config = await makeTempConfig();

    const result = await runPublishedSnapshotPipeline(config, {
      runId: 'run-empty-subject',
      generatedAt,
      sourceLoaders: makeSourceLoaders({
        emptyScheduleSubjects: ['MATH'],
      }),
    });

    const partialSnapshot = JSON.parse(
      await readFile(result.snapshotPath, 'utf-8'),
    ) as CatalogSnapshot;

    expect(partialSnapshot.courses.map((course) => course.subject)).toEqual([
      'CSE',
    ]);
    expect(result.manifest.cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject: 'MATH',
          source: 'schedule_of_classes',
          status: 'empty',
          reason: 'no Schedule of Classes rows for subject in term',
        }),
      ]),
    );
  });

  it('aborts systemic parser breakage and preserves the existing Published Snapshot', async () => {
    const config = await makeTempConfig();
    const existingSnapshot = buildTracerCatalogSnapshot(config, {
      runId: 'run-existing',
      generatedAt,
    });
    const published = await publishCatalogSnapshot(existingSnapshot, config);

    await expect(
      runPublishedSnapshotPipeline(config, {
        runId: 'run-systemic-parser-failure',
        generatedAt,
        fetchRetryDelayMs: 0,
        sourceLoaders: makeSourceLoaders({
          failScheduleParseSubjects: ['CSE', 'MATH'],
        }),
      }),
    ).rejects.toThrow(/Published Snapshot systemic parser failure/u);

    const stillPublished = JSON.parse(
      await readFile(published.snapshotPath, 'utf-8'),
    ) as CatalogSnapshot;
    const failureReport = JSON.parse(
      await readFile(
        join(
          config.paths.reports_dir,
          'run-systemic-parser-failure.import-report.json',
        ),
        'utf-8',
      ),
    ) as {
      status?: string;
      parser_errors?: { subject?: string; message?: string }[];
    };

    expect(stillPublished.run_id).toBe('run-existing');
    expect(failureReport.status).toBe('failed');
    expect(failureReport.parser_errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject: 'CSE',
          message: 'Schedule parser failed for CSE',
        }),
        expect.objectContaining({
          subject: 'MATH',
          message: 'Schedule parser failed for MATH',
        }),
      ]),
    );
    await expect(
      readFile(
        join(config.paths.public_catalog_dir, '../import-manifests/FA26.json'),
        'utf-8',
      ),
    ).rejects.toThrow();
  });

  it('rejects invalid staging snapshots and preserves the existing Published Snapshot', async () => {
    const config = await makeTempConfig();
    const existingSnapshot = buildTracerCatalogSnapshot(config, {
      runId: 'run-existing',
      generatedAt,
    });
    const published = await publishCatalogSnapshot(existingSnapshot, config);

    await expect(
      runPublishedSnapshotPipeline(config, {
        runId: 'run-validation-failure',
        generatedAt,
        sourceLoaders: makeSourceLoaders({
          unsafeScheduleRaw: true,
        }),
      }),
    ).rejects.toThrow(/Catalog Snapshot validation failed/u);

    const stillPublished = JSON.parse(
      await readFile(published.snapshotPath, 'utf-8'),
    ) as CatalogSnapshot;
    const failureReport = JSON.parse(
      await readFile(
        join(
          config.paths.reports_dir,
          'run-validation-failure.import-report.json',
        ),
        'utf-8',
      ),
    ) as {
      status?: string;
      validation?: { success?: boolean; errors?: string[] };
    };

    expect(stillPublished.run_id).toBe('run-existing');
    expect(failureReport.status).toBe('failed');
    expect(failureReport.validation).toMatchObject({
      success: false,
      errors: ['excluded field $.courses[0].sections[0].raw.waitlist'],
    });
  });
});
