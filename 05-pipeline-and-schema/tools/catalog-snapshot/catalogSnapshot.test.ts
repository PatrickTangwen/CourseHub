import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  attachGeneralCatalogMetadata,
  attachGradeArchiveRecords,
  buildTracerCatalogSnapshot,
  loadCatalogSnapshotConfig,
  publishCatalogSnapshot,
  validateCatalogSnapshot,
  type CatalogSnapshot,
  type CatalogSnapshotConfig,
} from './catalogSnapshot';
import type { GradeArchiveRecord } from './instructorGradeArchive';

function makeConfig(): CatalogSnapshotConfig {
  return {
    active_planning_term: 'FA26',
    term_label: 'Fall 2026',
    term_date_range: {
      start: '2026-09-24',
      end: '2026-12-12',
    },
    configured_subjects: ['CSE', 'MATH'],
    paths: {
      raw_dir: 'data/raw',
      normalized_dir: 'data/normalized',
      reports_dir: 'data/reports',
      public_catalog_dir: 'api/static/catalogs/public',
      metadata_path: 'api/static/metadata.json',
    },
  };
}

function setScheduledOffering(
  course: CatalogSnapshot['courses'][number],
  instructor: string,
  startTime = '09:00',
) {
  const section = course.sections[0]!;
  section.instructors = [instructor];
  section.meetings = [
    {
      date: null,
      days: ['Tuesday', 'Thursday'],
      start_time: startTime,
      end_time: '10:20',
      building: 'CENTR',
      room: '101',
      is_tba: false,
      meeting_type: 'Lecture',
      raw_days: 'TuTh',
      raw_time: `${startTime} - 10:20`,
      raw_location: 'CENTR 101',
    },
  ];
}

function gradeArchiveRecord(
  subject: string,
  course: string,
): GradeArchiveRecord {
  return {
    subject,
    course,
    year: '2025',
    quarter: 'FA',
    title: 'Cross-listed course',
    instructor: 'Shared Instructor',
    gpa: 3.5,
    a: 50,
    b: 50,
    c: 0,
    d: 0,
    f: 0,
    w: 0,
    p: 0,
    np: 0,
    raw: {},
  };
}

describe('Catalog Snapshot config', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it('loads Active Planning Term, subjects, term dates, and publish paths from YAML', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'catalog-snapshot-config-'));
    tempDirs.push(dir);
    const configPath = join(dir, 'catalog-snapshot.yaml');
    await writeFile(
      configPath,
      [
        'active_planning_term: FA26',
        'term_label: Fall 2026',
        'term_date_range:',
        '  start: "2026-09-24"',
        '  end: "2026-12-12"',
        'configured_subjects:',
        '  - CSE',
        '  - MATH',
        'paths:',
        '  raw_dir: data/raw',
        '  normalized_dir: data/normalized',
        '  reports_dir: data/reports',
        '  public_catalog_dir: api/static/catalogs/public',
        '  metadata_path: api/static/metadata.json',
        '',
      ].join('\n'),
      'utf-8',
    );

    const config = await loadCatalogSnapshotConfig(configPath);

    expect(config).toEqual(makeConfig());
  });

  it('keeps the Fall 2026 Term Date Range available for calendar export', async () => {
    const config = await loadCatalogSnapshotConfig(
      'config/catalog-snapshot.ucsd.yaml',
    );

    expect(config.term_date_ranges?.FA26).toEqual({
      start: '2026-09-24',
      end: '2026-12-12',
    });
  });
});

describe('Catalog Snapshot validation', () => {
  it('accepts a minimal tracer snapshot for every configured subject', () => {
    const config = makeConfig();
    const snapshot = buildTracerCatalogSnapshot(config, {
      runId: 'run-test',
      generatedAt: '2026-06-19T12:00:00.000Z',
    });

    const result = validateCatalogSnapshot(snapshot, config);

    expect(result).toEqual({ success: true, errors: [] });
    expect(snapshot.courses[0]?.sections[0]).toMatchObject({
      enrolled: null,
      capacity: null,
      waitlist_count: null,
      availability_verified: false,
      availability_timestamp: null,
    });
  });

  it('can seed tracer Courses with General Catalog metadata', () => {
    const config = makeConfig();
    const snapshot = buildTracerCatalogSnapshot(config, {
      runId: 'run-test',
      generatedAt: '2026-06-19T12:00:00.000Z',
      generalCatalogCourses: [
        {
          course_id: 'CSE:3',
          subject: 'CSE',
          course_number: '3',
          title: 'Fluency in Information Technology',
          units: '4',
          description:
            'Introduces the concepts and skills necessary to effectively use information technology.',
          prerequisites_text: 'none.',
          restrictions_text: null,
          catalog_url: 'https://catalog.ucsd.edu/courses/CSE.html#cse3',
        },
        {
          course_id: 'MATH:2',
          subject: 'MATH',
          course_number: '2',
          title: 'Introduction to College Mathematics',
          units: '4',
          description:
            'A highly adaptive course designed to build mathematical understanding.',
          prerequisites_text: 'Math Placement Exam qualifying score.',
          restrictions_text: null,
          catalog_url: 'https://catalog.ucsd.edu/courses/MATH.html#math2',
        },
      ],
    });

    expect(snapshot.courses).toMatchObject([
      {
        course_id: 'CSE:3',
        course_number: '3',
        title: 'Fluency in Information Technology',
        units: '4',
        description:
          'Introduces the concepts and skills necessary to effectively use information technology.',
        sections: [
          {
            section_id: 'FA26:CSE-TRACER-3',
            course_id: 'CSE:3',
          },
        ],
      },
      {
        course_id: 'MATH:2',
        course_number: '2',
        title: 'Introduction to College Mathematics',
        units: '4',
        sections: [
          {
            section_id: 'FA26:MATH-TRACER-2',
            course_id: 'MATH:2',
          },
        ],
      },
    ]);
    expect(validateCatalogSnapshot(snapshot, config)).toEqual({
      success: true,
      errors: [],
    });
  });

  it('allows configured subjects with no published courses', () => {
    const config = makeConfig();
    const snapshot = buildTracerCatalogSnapshot(config, {
      runId: 'run-test',
      generatedAt: '2026-06-19T12:00:00.000Z',
    });
    snapshot.courses = snapshot.courses.filter(
      (course) => course.subject !== 'MATH',
    );

    const result = validateCatalogSnapshot(snapshot, config);

    expect(result).toEqual({ success: true, errors: [] });
  });

  it('rejects sections without stable Section IDs for the Active Planning Term', () => {
    const config = makeConfig();
    const snapshot = buildTracerCatalogSnapshot(config, {
      runId: 'run-test',
      generatedAt: '2026-06-19T12:00:00.000Z',
    });
    snapshot.courses[0]!.sections[0]!.section_id = 'CSE-TRACER-001';

    const result = validateCatalogSnapshot(snapshot, config);

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'courses[0].sections[0].section_id must start with FA26:',
      ]),
    );
  });

  it('rejects excluded availability-tracking and demand fields in raw data', () => {
    const config = makeConfig();
    const snapshot = buildTracerCatalogSnapshot(config, {
      runId: 'run-test',
      generatedAt: '2026-06-19T12:00:00.000Z',
    });
    snapshot.courses[0]!.sections[0]!.raw = {
      waitlist: 10,
      demand: 'high',
    };

    const result = validateCatalogSnapshot(snapshot, config);

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'excluded field $.courses[0].sections[0].raw.waitlist',
        'excluded field $.courses[0].sections[0].raw.demand',
      ]),
    );
  });

  it('accepts source-provided snapshot-static availability fields on sections', () => {
    const config = makeConfig();
    const snapshot = buildTracerCatalogSnapshot(config, {
      runId: 'run-test',
      generatedAt: '2026-06-19T12:00:00.000Z',
    });
    snapshot.courses[0]!.sections[0]!.enrolled = 100;
    snapshot.courses[0]!.sections[0]!.capacity = 150;
    snapshot.courses[0]!.sections[0]!.available_seats = 50;
    snapshot.courses[0]!.sections[0]!.waitlist_count = 3;
    snapshot.courses[0]!.sections[0]!.availability_timestamp =
      '2026-06-19T12:00:00.000Z';

    const result = validateCatalogSnapshot(snapshot, config);

    expect(result).toEqual({ success: true, errors: [] });
  });

  it('rejects numeric seats on an effectively unbounded section', () => {
    const config = makeConfig();
    const snapshot = buildTracerCatalogSnapshot(config, {
      runId: 'run-test',
      generatedAt: '2026-06-19T12:00:00.000Z',
    });
    Object.assign(snapshot.courses[0]!.sections[0]!, {
      capacity: 9999,
      available_seats: 9999,
      capacity_kind: 'effectively_unbounded' as const,
      reported_capacity: 9999,
      availability_timestamp: '2026-06-19T12:00:00.000Z',
    });

    const result = validateCatalogSnapshot(snapshot, config);

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'effectively unbounded availability cannot publish numeric capacity or available seats',
        ),
      ]),
    );
  });

  it('rejects verified availability without a section or schedule timestamp', () => {
    const config = makeConfig();
    const snapshot = buildTracerCatalogSnapshot(config, {
      runId: 'run-test',
      generatedAt: '2026-06-19T12:00:00.000Z',
    });
    snapshot.source_timestamps.schedule_of_classes = null;
    snapshot.courses[0]!.sections[0]!.availability_verified = true;
    snapshot.courses[0]!.sections[0]!.availability_timestamp = null;

    const result = validateCatalogSnapshot(snapshot, config);

    expect(result).toEqual({
      success: false,
      errors: [
        'courses[0].sections[0] verified availability requires a timestamp',
      ],
    });
  });

  it('rejects excluded Availability Data, friends, and evaluation field names across common key styles', () => {
    const config = makeConfig();
    const snapshot = buildTracerCatalogSnapshot(config, {
      runId: 'run-test',
      generatedAt: '2026-06-19T12:00:00.000Z',
    });
    snapshot.courses[0]!.sections[0]!.raw = {
      availability: 'open',
      seatAvailability: 'open',
      friendCount: 3,
      evaluation_statistic: {},
      professorQuality: 4,
    };

    const result = validateCatalogSnapshot(snapshot, config);

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'excluded field $.courses[0].sections[0].raw.availability',
        'excluded field $.courses[0].sections[0].raw.seatAvailability',
        'excluded field $.courses[0].sections[0].raw.friendCount',
        'excluded field $.courses[0].sections[0].raw.evaluation_statistic',
        'excluded field $.courses[0].sections[0].raw.professorQuality',
      ]),
    );
  });
});

describe('Catalog Snapshot Grade Archive enrichment', () => {
  it('attaches matching Grade Archive Records and computes unweighted average GPA for the most recent term', () => {
    const config = makeConfig();
    const snapshot = buildTracerCatalogSnapshot(config, {
      runId: 'run-test',
      generatedAt: '2026-06-19T12:00:00.000Z',
    });

    const enriched = attachGradeArchiveRecords(snapshot, [
      {
        subject: 'CSE',
        course: '1',
        year: '2025',
        quarter: 'FA',
        title: 'CSE Tracer Course',
        instructor: 'Hopper, Grace',
        gpa: 3,
        a: 40,
        b: 30,
        c: 20,
        d: 5,
        f: 1,
        w: 4,
        p: 0,
        np: 0,
        raw: {
          Subject: 'CSE',
          Course: '1',
          Year: '2025',
          Quarter: 'FA',
          Title: 'CSE Tracer Course',
          Instructor: 'Hopper, Grace',
          GPA: '3.00',
          A: '40',
          B: '30',
          C: '20',
          D: '5',
          F: '1',
          W: '4',
          P: '0',
          NP: '0',
        },
      },
      {
        subject: 'CSE',
        course: '1',
        year: '2025',
        quarter: 'FA',
        title: 'CSE Tracer Course',
        instructor: 'Lovelace, Ada',
        gpa: 4,
        a: 80,
        b: 10,
        c: 5,
        d: 2,
        f: 1,
        w: 2,
        p: 0,
        np: 0,
        raw: {
          Subject: 'CSE',
          Course: '1',
          Year: '2025',
          Quarter: 'FA',
          Title: 'CSE Tracer Course',
          Instructor: 'Lovelace, Ada',
          GPA: '4.00',
          A: '80',
          B: '10',
          C: '5',
          D: '2',
          F: '1',
          W: '2',
          P: '0',
          NP: '0',
        },
      },
      {
        subject: 'CSE',
        course: '1',
        year: '2025',
        quarter: 'WI',
        title: 'CSE Tracer Course',
        instructor: 'Dijkstra, Edsger',
        gpa: 1,
        a: 10,
        b: 30,
        c: 20,
        d: 5,
        f: 1,
        w: 4,
        p: 0,
        np: 0,
        raw: {
          Subject: 'CSE',
          Course: '1',
          Year: '2025',
          Quarter: 'WI',
          Title: 'CSE Tracer Course',
          Instructor: 'Dijkstra, Edsger',
          GPA: '1.00',
          A: '10',
          B: '30',
          C: '20',
          D: '5',
          F: '1',
          W: '4',
          P: '0',
          NP: '0',
        },
      },
      {
        subject: 'MATH',
        course: '1',
        year: '2024',
        quarter: 'SP',
        title: 'MATH Tracer Course',
        instructor: 'Noether, Emmy',
        gpa: 4,
        a: 80,
        b: 15,
        c: 5,
        d: 0,
        f: 0,
        w: 0,
        p: 0,
        np: 0,
        raw: {
          Subject: 'MATH',
          Course: '1',
          Year: '2024',
          Quarter: 'SP',
          Title: 'MATH Tracer Course',
          Instructor: 'Noether, Emmy',
          GPA: '4.00',
          A: '80',
          B: '15',
          C: '5',
          D: '0',
          F: '0',
          W: '0',
          P: '0',
          NP: '0',
        },
      },
    ]);

    expect(enriched.courses[0]).toMatchObject({
      archive_avg_gpa: 3.5,
      archive_record_count: 3,
      grade_archive_records: [
        {
          instructor: 'Hopper, Grace',
          gpa: 3,
          raw: {
            GPA: '3.00',
          },
        },
        {
          instructor: 'Lovelace, Ada',
          gpa: 4,
          raw: {
            GPA: '4.00',
          },
        },
        {
          instructor: 'Dijkstra, Edsger',
          gpa: 1,
          raw: {
            GPA: '1.00',
          },
        },
      ],
    });
    expect(enriched.courses[1]).toMatchObject({
      archive_avg_gpa: 4,
      archive_record_count: 1,
    });
    expect(validateCatalogSnapshot(enriched, config)).toEqual({
      success: true,
      errors: [],
    });
  });

  it('does not inherit cross-listed records when current offerings do not share instructor and time', () => {
    const snapshot = buildTracerCatalogSnapshot(makeConfig());
    const target = snapshot.courses[0]!;
    const source = snapshot.courses[1]!;
    target.description = '(Cross-listed with MATH 1.)';
    setScheduledOffering(target, 'Target Instructor');
    setScheduledOffering(source, 'Source Instructor');

    const enriched = attachGradeArchiveRecords(snapshot, [
      gradeArchiveRecord('MATH', '1'),
    ]);

    expect(enriched.courses[0]).toMatchObject({
      archive_record_count: 0,
      grade_archive_records: [],
    });
  });

  it('does not merge multiple current cross-listed sources with archive rows', () => {
    const snapshot = buildTracerCatalogSnapshot(makeConfig());
    const target = snapshot.courses[0]!;
    const math = snapshot.courses[1]!;
    const physics = structuredClone(math);
    physics.course_id = 'PHYS:1';
    physics.subject = 'PHYS';
    physics.sections[0]!.course_id = 'PHYS:1';
    target.description = '(Cross-listed with MATH 1 and PHYS 1.)';
    setScheduledOffering(target, 'Shared Instructor');
    setScheduledOffering(math, 'Shared Instructor');
    setScheduledOffering(physics, 'Shared Instructor');
    snapshot.courses.push(physics);

    const enriched = attachGradeArchiveRecords(snapshot, [
      gradeArchiveRecord('MATH', '1'),
      gradeArchiveRecord('PHYS', '1'),
    ]);

    expect(enriched.courses[0]).toMatchObject({
      archive_record_count: 0,
      grade_archive_records: [],
    });
  });
});

describe('Catalog Snapshot General Catalog enrichment', () => {
  it('attaches General Catalog metadata to matching Courses by Course ID', () => {
    const config = makeConfig();
    const snapshot = buildTracerCatalogSnapshot(config, {
      runId: 'run-test',
      generatedAt: '2026-06-19T12:00:00.000Z',
    });

    const enriched = attachGeneralCatalogMetadata(snapshot, [
      {
        course_id: 'CSE:1',
        subject: 'CSE',
        course_number: '1',
        title: 'Fluency in Information Technology',
        units: '4',
        description:
          'Introduces the concepts and skills necessary to effectively use information technology.',
        prerequisites_text: 'none.',
        restrictions_text: null,
        catalog_url: 'https://catalog.ucsd.edu/courses/CSE.html#cse1',
      },
      {
        course_id: 'MATH:1',
        subject: 'MATH',
        course_number: '1',
        title: 'Adaptive Mathematics',
        units: '2',
        description:
          'A highly adaptive course designed to build mathematical understanding.',
        prerequisites_text: 'Math Placement Exam qualifying score.',
        restrictions_text: 'Must be taken for P/NP grading.',
        catalog_url: 'https://catalog.ucsd.edu/courses/MATH.html#math1',
      },
    ]);

    expect(enriched.courses[0]).toMatchObject({
      title: 'Fluency in Information Technology',
      units: '4',
      description:
        'Introduces the concepts and skills necessary to effectively use information technology.',
      prerequisites_text: 'none.',
      restrictions_text: null,
      catalog_url: 'https://catalog.ucsd.edu/courses/CSE.html#cse1',
    });
    expect(enriched.courses[1]).toMatchObject({
      title: 'Adaptive Mathematics',
      units: '2',
      prerequisites_text: 'Math Placement Exam qualifying score.',
      restrictions_text: 'Must be taken for P/NP grading.',
    });
    expect(validateCatalogSnapshot(enriched, config)).toEqual({
      success: true,
      errors: [],
    });
  });

  it('leaves Courses unchanged when no General Catalog metadata matches', () => {
    const config = makeConfig();
    const snapshot = buildTracerCatalogSnapshot(config, {
      runId: 'run-test',
      generatedAt: '2026-06-19T12:00:00.000Z',
    });

    const enriched = attachGeneralCatalogMetadata(snapshot, [
      {
        course_id: 'CSE:101',
        subject: 'CSE',
        course_number: '101',
        title: 'Design and Analysis of Algorithms',
        units: '4',
        description: 'Design and analysis of efficient algorithms.',
        prerequisites_text: 'CSE 21 and CSE 12.',
        restrictions_text: null,
        catalog_url: 'https://catalog.ucsd.edu/courses/CSE.html#cse101',
      },
    ]);

    expect(enriched.courses[0]).toEqual(snapshot.courses[0]);
    expect(enriched.courses[1]).toEqual(snapshot.courses[1]);
  });
});

describe('Catalog Snapshot publishing', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function makeTempConfig() {
    const dir = await mkdtemp(join(tmpdir(), 'catalog-snapshot-'));
    tempDirs.push(dir);
    const config = makeConfig();
    return {
      ...config,
      paths: {
        ...config.paths,
        public_catalog_dir: join(dir, 'public'),
        metadata_path: join(dir, 'metadata.json'),
      },
    };
  }

  it('publishes a validated tracer snapshot and metadata to configured paths', async () => {
    const config = await makeTempConfig();
    const snapshot = buildTracerCatalogSnapshot(config, {
      runId: 'run-publish',
      generatedAt: '2026-06-19T12:00:00.000Z',
    });

    const result = await publishCatalogSnapshot(snapshot, config);

    const publishedSnapshot = JSON.parse(
      await readFile(result.snapshotPath, 'utf-8'),
    ) as unknown;
    const metadata = JSON.parse(
      await readFile(config.paths.metadata_path, 'utf-8'),
    ) as { run_id?: string; active_planning_term?: string };

    expect(result.snapshotPath).toBe(
      join(config.paths.public_catalog_dir, 'FA26.json'),
    );
    expect(publishedSnapshot).toMatchObject({
      run_id: 'run-publish',
      active_planning_term: 'FA26',
    });
    expect(metadata).toMatchObject({
      run_id: 'run-publish',
      active_planning_term: 'FA26',
    });
  });

  it('does not overwrite the existing Published Snapshot when validation fails', async () => {
    const config = await makeTempConfig();
    const existingSnapshot = buildTracerCatalogSnapshot(config, {
      runId: 'run-existing',
      generatedAt: '2026-06-19T12:00:00.000Z',
    });
    const invalidSnapshot = buildTracerCatalogSnapshot(config, {
      runId: 'run-invalid',
      generatedAt: '2026-06-19T13:00:00.000Z',
    });
    invalidSnapshot.courses[0]!.sections[0]!.raw = {
      seats_available: 20,
    };

    const result = await publishCatalogSnapshot(existingSnapshot, config);
    await expect(
      publishCatalogSnapshot(invalidSnapshot, config),
    ).rejects.toThrow(/validation failed/u);

    const stillPublished = JSON.parse(
      await readFile(result.snapshotPath, 'utf-8'),
    ) as { run_id?: string };
    const metadata = JSON.parse(
      await readFile(config.paths.metadata_path, 'utf-8'),
    ) as { run_id?: string };

    expect(stillPublished.run_id).toBe('run-existing');
    expect(metadata.run_id).toBe('run-existing');
  });
});
