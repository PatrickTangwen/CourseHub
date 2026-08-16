import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { CatalogSnapshot, CatalogSnapshotConfig } from './catalogSnapshot';
import type { PublishedSnapshotImportManifest } from './publishedSnapshotPipeline';
import { runTssPublishedSnapshotPipeline } from './tssPublishedSnapshotPipeline';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('TSS Published Snapshot entrypoint', () => {
  it('reads raw and metadata directories and publishes a self-contained FA26 snapshot', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'tss-pipeline-'));
    tempDirectories.push(root);
    const rawDirectory = path.join(root, 'raw');
    const metadataRootDirectory = path.join(root, 'normalized-runs');
    const metadataDirectory = path.join(
      metadataRootDirectory,
      'multi-2026-06-29T08:02:01.606Z-primary-S226',
    );
    const moreCompleteMetadataDirectory = path.join(
      metadataRootDirectory,
      'multi-2026-06-29T14:30:40.925Z-fallback-SP25',
    );
    const futureMetadataDirectory = path.join(
      metadataRootDirectory,
      'multi-2026-07-23T00:00:00.000Z-future-S126',
    );
    const generalDirectory = path.join(metadataDirectory, 'general_catalog');
    const gradeDirectory = path.join(
      metadataDirectory,
      'instructor_grade_archive',
    );
    const moreCompleteGeneralDirectory = path.join(
      moreCompleteMetadataDirectory,
      'general_catalog',
    );
    const moreCompleteGradeDirectory = path.join(
      moreCompleteMetadataDirectory,
      'instructor_grade_archive',
    );
    const futureGeneralDirectory = path.join(
      futureMetadataDirectory,
      'general_catalog',
    );
    const publicDirectory = path.join(root, 'public');
    await Promise.all([
      mkdir(rawDirectory, { recursive: true }),
      mkdir(generalDirectory, { recursive: true }),
      mkdir(gradeDirectory, { recursive: true }),
      mkdir(moreCompleteGeneralDirectory, { recursive: true }),
      mkdir(moreCompleteGradeDirectory, { recursive: true }),
      mkdir(futureGeneralDirectory, { recursive: true }),
    ]);

    await writeFile(
      path.join(rawDirectory, 'CAT.json'),
      JSON.stringify({
        schema_version: 'tss-chatbot-v1',
        term: 'FA26',
        requested_course: 'CAT, CSE, MATH',
        source_metadata: {
          last_refreshed_displayed: '2026-07-20T00:00:00-07:00',
        },
        coverage: { complete: true, continuation_needed: false },
        courses: [
          {
            course_code: '001',
            course_title: 'CAT 001',
            tss_course_code: 'CAT-001',
            booking_choices: [
              {
                booking_choice_ordinal: 1,
                displayed_package_section: null,
                displayed_package_id: null,
                components: [
                  {
                    type: 'lecture',
                    section_code: '001-000-LE',
                    event_id: 'E 00000665',
                    requirement: 'required',
                    meetings: [
                      {
                        meeting_kind: 'class',
                        specific_date: null,
                        days: 'T R',
                        start_time: '09:00am',
                        end_time: '10:20am',
                        location_displayed: 'CENTR 101',
                        instructor: 'Shared Instructor',
                        is_tba: false,
                        is_arranged: false,
                      },
                    ],
                    enrollment: {
                      enrolled: null,
                      capacity: null,
                      seats_available: 20,
                      waitlist: { state: 'not_shown', count: null },
                    },
                  },
                ],
              },
            ],
          },
          {
            course_code: '002',
            course_title: 'CAT 002',
            tss_course_code: 'CAT-002',
            booking_choices: [
              {
                booking_choice_ordinal: 1,
                displayed_package_section: null,
                displayed_package_id: null,
                components: [
                  {
                    type: 'lecture',
                    section_code: '002-000-LE',
                    event_id: 'E 00000666',
                    requirement: 'required',
                    meetings: [
                      {
                        meeting_kind: 'class',
                        specific_date: null,
                        days: 'T R',
                        start_time: '09:00am',
                        end_time: '10:20am',
                        location_displayed: 'CENTR 101',
                        instructor: 'Shared Instructor',
                        is_tba: false,
                        is_arranged: false,
                      },
                    ],
                    enrollment: {
                      enrolled: null,
                      capacity: null,
                      seats_available: null,
                      waitlist: { state: 'not_shown', count: null },
                    },
                  },
                ],
              },
            ],
          },
        ],
      }),
      'utf-8',
    );
    await writeFile(
      path.join(rawDirectory, 'capacity_enrollment_supp.txt'),
      [
        'Subject,Course,Section,Type,Instructor,Seats_Total,Seats_Available',
        'CAT,001,001-000-LE,lecture,Phoebe Bronstein,100,20',
      ].join('\n'),
      'utf-8',
    );
    await writeFile(
      path.join(generalDirectory, 'CAT.json'),
      JSON.stringify([
        {
          course_id: 'CAT:1',
          subject: 'CAT',
          course_number: '1',
          title: 'Culture, Art, and Technology 1',
          units: '4',
          description: 'General Catalog description.',
          prerequisites_text: null,
          restrictions_text: null,
          catalog_url: 'https://catalog.ucsd.edu/courses/CAT.html#cat1',
        },
        {
          course_id: 'CAT:3',
          subject: 'CAT',
          course_number: '3',
          title: 'Culture, Art, and Technology 3',
          units: '4',
          description: 'A same-sized candidate from the older run.',
          prerequisites_text: null,
          restrictions_text: null,
          catalog_url: 'https://catalog.ucsd.edu/courses/CAT.html#cat3',
        },
      ]),
      'utf-8',
    );
    await writeFile(path.join(gradeDirectory, 'CAT.json'), '[]', 'utf-8');
    await writeFile(
      path.join(moreCompleteGeneralDirectory, 'CAT.json'),
      JSON.stringify([
        {
          course_id: 'CAT:1',
          subject: 'CAT',
          course_number: '1',
          title: 'Culture, Art, and Technology 1',
          units: '4',
          description: 'Most complete General Catalog description.',
          prerequisites_text: null,
          restrictions_text: null,
          catalog_url: 'https://catalog.ucsd.edu/courses/CAT.html#cat1',
        },
        {
          course_id: 'CAT:2',
          subject: 'CAT',
          course_number: '2',
          title: 'Culture, Art, and Technology 2',
          units: '4',
          description:
            '(Cross-listed with CAT 1.) A second catalog row makes this file more complete.',
          prerequisites_text: null,
          restrictions_text: null,
          catalog_url: 'https://catalog.ucsd.edu/courses/CAT.html#cat2',
        },
      ]),
      'utf-8',
    );
    await writeFile(
      path.join(moreCompleteGradeDirectory, 'CAT.json'),
      JSON.stringify([
        {
          subject: 'CAT',
          course: '1',
          year: '26',
          quarter: 'SP',
          title: 'Culture, Art, and Technology 1',
          instructor: 'Test Instructor',
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
        },
      ]),
      'utf-8',
    );
    await writeFile(
      path.join(futureGeneralDirectory, 'CAT.json'),
      JSON.stringify([
        {
          course_id: 'CAT:1',
          subject: 'CAT',
          course_number: '1',
          title: 'Culture, Art, and Technology 1',
          units: '4',
          description: 'Future metadata must be excluded by the cutoff.',
          prerequisites_text: null,
          restrictions_text: null,
          catalog_url: 'https://catalog.ucsd.edu/courses/CAT.html#cat1',
        },
        {
          course_id: 'CAT:2',
          subject: 'CAT',
          course_number: '2',
          title: 'Culture, Art, and Technology 2',
          units: '4',
          description: 'Future metadata must be excluded by the cutoff.',
          prerequisites_text: null,
          restrictions_text: null,
          catalog_url: 'https://catalog.ucsd.edu/courses/CAT.html#cat2',
        },
      ]),
      'utf-8',
    );
    const metadataPath = path.join(root, 'metadata.json');
    await writeFile(
      metadataPath,
      JSON.stringify({
        last_update: '2026-07-20T12:00:00.000Z',
        terms: [
          {
            term: 'SP26',
            label: 'Spring 2026',
            date_range: null,
            frozen: false,
            generated_at: '2026-07-20T12:00:00.000Z',
            snapshot_path: 'catalogs/public/SP26.json',
            manifest_path: 'catalogs/import-manifests/SP26.json',
          },
        ],
      }),
      'utf-8',
    );

    const config: CatalogSnapshotConfig = {
      active_planning_term: 'SP26',
      term_label: 'Spring 2026',
      term_date_range: null,
      term_date_ranges: {
        FA26: { start: '2026-09-24', end: '2026-12-12' },
      },
      configured_subjects: ['CSE'],
      paths: {
        raw_dir: path.join(root, 'pipeline-raw'),
        normalized_dir: path.join(root, 'pipeline-normalized'),
        reports_dir: path.join(root, 'reports'),
        public_catalog_dir: publicDirectory,
        metadata_path: metadataPath,
      },
    };
    const result = await runTssPublishedSnapshotPipeline({
      config,
      rawDirectory,
      metadataDirectory,
      metadataRootDirectory,
      metadataCutoffTimestamp: '2026-07-22T23:59:59.999Z',
      metadataSourceTimestamp: '2026-06-29T08:02:01.606Z',
      runId: 'tss-entrypoint-test',
      generatedAt: '2026-07-21T12:00:00.000Z',
    });
    const published = JSON.parse(
      await readFile(result.snapshotPath, 'utf-8'),
    ) as CatalogSnapshot;
    const registry = JSON.parse(await readFile(metadataPath, 'utf-8')) as {
      terms: {
        term: string;
        frozen: boolean;
        manifest_path: string | null;
      }[];
    };
    const manifest = JSON.parse(
      await readFile(result.manifestPath, 'utf-8'),
    ) as PublishedSnapshotImportManifest;

    expect(result.snapshot).toMatchObject({
      active_planning_term: 'FA26',
      term_label: 'Fall 2026',
      configured_subjects: ['CAT', 'CSE', 'MATH'],
      coverage: { complete: true, continuation_needed: false },
      source_timestamps: {
        general_catalog: '2026-06-29T14:30:40.925Z',
        instructor_grade_archive: '2026-06-29T14:30:40.925Z',
      },
    });
    expect(result.availabilitySupplement).toMatchObject({
      records: 1,
      matchedRecords: 1,
      updatedComponents: 1,
      overriddenValues: 0,
      unmatchedRecords: 0,
      unmatchedKeys: [],
    });
    expect(published.courses[0]).toMatchObject({
      course_id: 'CAT:1',
      display_course_code: 'CAT-001',
      description: 'Most complete General Catalog description.',
      catalog_url: 'https://catalog.ucsd.edu/courses/CAT.html#cat1',
      archive_record_count: 1,
      grade_archive_records: [{ gpa: 3.5 }],
      sections: [
        {
          enrolled: null,
          capacity: 100,
          available_seats: 20,
          capacity_kind: 'bounded',
        },
      ],
    });
    const catOne = published.courses.find(
      (course) => course.course_id === 'CAT:1',
    )!;
    const catTwo = published.courses.find(
      (course) => course.course_id === 'CAT:2',
    )!;
    expect(catTwo.description).toContain('Cross-listed with CAT 1');
    expect(catOne.grade_archive_records).toHaveLength(1);
    expect(
      catTwo.sections.map(({ instructors, meetings }) => ({
        instructors,
        meetings,
      })),
    ).toEqual(
      catOne.sections.map(({ instructors, meetings }) => ({
        instructors,
        meetings,
      })),
    );
    expect(catTwo).toMatchObject({
      archive_record_count: 1,
      grade_archive_records: [
        {
          subject: 'CAT',
          course: '1',
          gpa: 3.5,
          matched_via: 'cross_listed',
        },
      ],
    });
    expect(registry.terms).toMatchObject([
      {
        term: 'FA26',
        frozen: false,
        manifest_path: 'catalogs/import-manifests/FA26.json',
      },
      { term: 'SP26', frozen: false },
    ]);
    expect(manifest).toMatchObject({
      active_planning_term: 'FA26',
      summary: { ok: 3, empty: 2, failed: 4, partial: 0 },
    });
    expect(manifest.cells).toHaveLength(9);
    const catSchedule = manifest.cells.find(
      ({ source, subject }) =>
        source === 'schedule_of_classes' && subject === 'CAT',
    );
    expect(catSchedule).toMatchObject({
      status: 'ok',
      reason: null,
      attempts: 1,
      row_counts: { courses: 2, sections: 2, meetings: 2 },
      normalized_artifact: null,
    });
    expect(catSchedule?.raw_artifacts).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/CAT\.json$/u),
        expect.stringMatching(/capacity_enrollment_supp\.txt$/u),
      ]),
    );
    expect(manifest.cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'general_catalog',
          subject: 'CSE',
          status: 'failed',
        }),
        expect.objectContaining({
          source: 'instructor_grade_archive',
          subject: 'CAT',
          status: 'ok',
        }),
      ]),
    );
    const catCatalog = manifest.cells.find(
      ({ source, subject }) =>
        source === 'general_catalog' && subject === 'CAT',
    );
    const catGrades = manifest.cells.find(
      ({ source, subject }) =>
        source === 'instructor_grade_archive' && subject === 'CAT',
    );
    expect(catCatalog?.normalized_artifact).toBe(
      path.join(moreCompleteGeneralDirectory, 'CAT.json'),
    );
    expect(catGrades?.normalized_artifact).toBe(
      path.join(moreCompleteGradeDirectory, 'CAT.json'),
    );
  });
});
