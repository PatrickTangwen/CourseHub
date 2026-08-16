import { describe, expect, it } from 'vitest';

import {
  validateCatalogSnapshot,
  type CatalogSnapshotConfig,
} from './catalogSnapshot';
import { buildTssCatalogSnapshot } from './tssSchedule';

const config: CatalogSnapshotConfig = {
  active_planning_term: 'FA26',
  term_label: 'Fall 2026',
  term_date_range: null,
  configured_subjects: ['CAT'],
  paths: {
    raw_dir: 'data/raw',
    normalized_dir: 'data/normalized',
    reports_dir: 'data/reports',
    public_catalog_dir: 'api/static/catalogs/public',
    metadata_path: 'api/static/metadata.json',
  },
};

const tssResponse = {
  schema_version: 'tss-chatbot-v1',
  term: 'FA26',
  source_metadata: {
    last_refreshed_displayed: '2026-07-21T12:00:00.000Z',
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
                  days: 'M W F',
                  start_time: '11:00am',
                  end_time: '11:50am',
                  location_displayed: 'PRICE THTRE' as string | null,
                  instructor: 'Phoebe Bronstein',
                  is_remote: false,
                  is_tba: false,
                  is_arranged: null,
                },
              ],
              enrollment: {
                enrolled: 200,
                capacity: 256,
                seats_available: 56,
                waitlist: {
                  state: 'not_shown',
                  count: null,
                  available_spots: null as number | null,
                },
              },
            },
          ],
        },
      ],
    },
  ],
};

describe('TSS Catalog Snapshot pipeline input', () => {
  it('combines matching TSS component meetings across weekdays', () => {
    const response = structuredClone(tssResponse);
    const lecture = response.courses[0]!.booking_choices[0]!.components[0]!;
    const baseMeeting = lecture.meetings[0]!;
    lecture.meetings = ['F', 'M', 'W'].map((days) => ({
      ...baseMeeting,
      days,
      instructor: days === 'W' ? 'Grace Hopper' : baseMeeting.instructor,
    }));

    const snapshot = buildTssCatalogSnapshot(config, [response], {
      runId: 'tss-fa26-combined-weekdays-test',
      generatedAt: '2026-07-21T12:00:00.000Z',
      generalCatalog: {
        sourceTimestamp: '2026-07-20T12:00:00.000Z',
        courses: [],
      },
      gradeArchive: {
        sourceTimestamp: '2026-07-19T12:00:00.000Z',
        records: [],
      },
    });

    expect(snapshot.courses[0]?.sections[0]?.meetings).toEqual([
      expect.objectContaining({
        days: ['Monday', 'Wednesday', 'Friday'],
        meeting_type: 'Lecture',
        raw_days: 'MWF',
        start_time: '11:00',
        end_time: '11:50',
        raw_location: 'PRICE THTRE',
      }),
    ]);
    expect(snapshot.courses[0]?.sections[0]?.instructors).toEqual([
      'Phoebe Bronstein',
      'Grace Hopper',
    ]);
  });

  it('keeps matching component meetings separate outside FA26', () => {
    const response = structuredClone(tssResponse);
    response.term = 'SP26';
    const lecture = response.courses[0]!.booking_choices[0]!.components[0]!;
    const baseMeeting = lecture.meetings[0]!;
    lecture.meetings = ['F', 'M', 'W'].map((days) => ({
      ...baseMeeting,
      days,
    }));

    const snapshot = buildTssCatalogSnapshot(
      {
        ...config,
        active_planning_term: 'SP26',
        term_label: 'Spring 2026',
      },
      [response],
      {
        runId: 'tss-sp26-separate-weekdays-test',
        generatedAt: '2026-07-21T12:00:00.000Z',
        generalCatalog: {
          sourceTimestamp: '2026-07-20T12:00:00.000Z',
          courses: [],
        },
        gradeArchive: {
          sourceTimestamp: '2026-07-19T12:00:00.000Z',
          records: [],
        },
      },
    );

    expect(snapshot.courses[0]?.sections[0]?.meetings).toMatchObject([
      { days: ['Friday'], raw_days: 'F' },
      { days: ['Monday'], raw_days: 'M' },
      { days: ['Wednesday'], raw_days: 'W' },
    ]);
  });

  it('keeps same-type component meetings separate when their schedule differs', () => {
    const response = structuredClone(tssResponse);
    const lecture = response.courses[0]!.booking_choices[0]!.components[0]!;
    const baseMeeting = lecture.meetings[0]!;
    lecture.meetings = [
      { ...baseMeeting, days: 'M' },
      { ...baseMeeting, days: 'W', location_displayed: 'CENTR 101' },
    ];

    const snapshot = buildTssCatalogSnapshot(config, [response], {
      runId: 'tss-fa26-distinct-schedules-test',
      generatedAt: '2026-07-21T12:00:00.000Z',
      generalCatalog: {
        sourceTimestamp: '2026-07-20T12:00:00.000Z',
        courses: [],
      },
      gradeArchive: {
        sourceTimestamp: '2026-07-19T12:00:00.000Z',
        records: [],
      },
    });

    expect(snapshot.courses[0]?.sections[0]?.meetings).toMatchObject([
      { days: ['Monday'], raw_location: 'PRICE THTRE' },
      { days: ['Wednesday'], raw_location: 'CENTR 101' },
    ]);
  });

  it('publishes remote meetings without treating available waitlist spots as demand', () => {
    const response = structuredClone(tssResponse);
    const component = response.courses[0]!.booking_choices[0]!.components[0]!;
    component.meetings[0] = {
      ...component.meetings[0]!,
      location_displayed: null,
      is_remote: true,
    };
    component.enrollment.waitlist = {
      state: 'available_spots',
      count: null,
      available_spots: 4,
    };

    const snapshot = buildTssCatalogSnapshot(config, [response], {
      runId: 'tss-fa26-remote-test',
      generatedAt: '2026-07-21T12:00:00.000Z',
      generalCatalog: { sourceTimestamp: null, courses: [] },
      gradeArchive: { sourceTimestamp: null, records: [] },
    });

    expect(snapshot.courses[0]?.sections[0]).toMatchObject({
      waitlist_count: null,
      meetings: [
        {
          building: 'REMOTE',
          room: null,
          raw_location: 'REMOTE',
          is_tba: false,
        },
      ],
      raw: {
        tss_waitlist_available: [
          { event_id: 'E 00000665', available_spots: 4 },
        ],
      },
    });
  });

  it('preserves availability-only component provenance and instructors', () => {
    const response = {
      ...tssResponse,
      courses: tssResponse.courses.map((course) => ({
        ...course,
        booking_choices: course.booking_choices.map((choice) => ({
          ...choice,
          components: choice.components.map((component) => ({
            ...component,
            instructors_text: 'Xiaohua Huang',
            status: 'AC',
            is_cancelled: false,
            meetings: [],
            enrollment: {
              ...component.enrollment,
              waitlist: {
                state: 'available_spots',
                count: 4,
                capacity: 10,
                available_spots: 6,
              },
            },
          })),
        })),
      })),
    };

    const snapshot = buildTssCatalogSnapshot(config, [response], {
      runId: 'tss-fa26-availability-only-test',
      generatedAt: '2026-07-22T19:06:00.000Z',
      generalCatalog: { sourceTimestamp: null, courses: [] },
      gradeArchive: { sourceTimestamp: null, records: [] },
    });

    expect(snapshot.courses[0]?.sections[0]).toMatchObject({
      instructors: ['Xiaohua Huang'],
      meetings: [],
      waitlist_count: 4,
      raw: {
        tss_component_statuses: [
          { event_id: 'E 00000665', status: 'AC', is_cancelled: false },
        ],
        tss_waitlist_capacity: [{ event_id: 'E 00000665', capacity: 10 }],
        tss_waitlist_available: [
          { event_id: 'E 00000665', available_spots: 6 },
        ],
      },
    });
  });

  it('publishes an FA26 display code while enriching by canonical Course ID', () => {
    const snapshot = buildTssCatalogSnapshot(config, [tssResponse], {
      runId: 'tss-fa26-test',
      generatedAt: '2026-07-21T12:00:00.000Z',
      generalCatalog: {
        sourceTimestamp: '2026-07-20T12:00:00.000Z',
        courses: [
          {
            course_id: 'CAT:1',
            subject: 'CAT',
            course_number: '1',
            title: 'Culture, Art, and Technology 1',
            units: '4',
            description: 'General Catalog description.',
            prerequisites_text: 'Sixth College students only.',
            restrictions_text: null,
            catalog_url: 'https://catalog.ucsd.edu/courses/CAT.html#cat1',
          },
        ],
      },
      gradeArchive: {
        sourceTimestamp: '2026-07-19T12:00:00.000Z',
        records: [
          {
            subject: 'CAT',
            course: '1',
            year: '25',
            quarter: 'FA',
            title: 'Culture, Art & Technology I',
            instructor: 'Ada Lovelace',
            gpa: 3.8,
            a: null,
            b: null,
            c: null,
            d: null,
            f: null,
            w: null,
            p: null,
            np: null,
            raw: {},
          },
        ],
      },
    });

    expect(snapshot.courses[0]).toMatchObject({
      course_id: 'CAT:1',
      course_number: '1',
      display_course_code: 'CAT-001',
      title: 'Culture, Art, and Technology 1',
      units: '4',
      description: 'General Catalog description.',
      catalog_url: 'https://catalog.ucsd.edu/courses/CAT.html#cat1',
      archive_record_count: 1,
      grade_archive_records: [{ gpa: 3.8 }],
      sections: [
        {
          section_id: 'FA26:CAT-001:E00000665',
          course_id: 'CAT:1',
          section_code: '001-000-LE',
          available_seats: 56,
          waitlist_count: null,
          availability_verified: true,
          availability_timestamp: '2026-07-21T12:00:00.000Z',
        },
      ],
    });
    expect(snapshot.coverage).toEqual({
      complete: true,
      continuation_needed: false,
    });
    expect(snapshot.source_timestamps).toEqual({
      schedule_of_classes: '2026-07-21T12:00:00.000Z',
      general_catalog: '2026-07-20T12:00:00.000Z',
      instructor_grade_archive: '2026-07-19T12:00:00.000Z',
    });
    expect(validateCatalogSnapshot(snapshot, config)).toEqual({
      success: true,
      errors: [],
    });
  });

  it('uses the observation time when the source shows no refresh time', () => {
    const response = {
      ...structuredClone(tssResponse),
      source_metadata: {
        last_refreshed_displayed: null,
        availability_observed_at: '2026-07-22T19:06:00.000Z',
      },
    };
    const snapshot = buildTssCatalogSnapshot(config, [response], {
      runId: 'tss-fa26-observed-availability-test',
      generatedAt: '2026-07-22T19:06:00.000Z',
      generalCatalog: { sourceTimestamp: null, courses: [] },
      gradeArchive: { sourceTimestamp: null, records: [] },
    });

    expect(snapshot.courses[0]?.sections[0]).toMatchObject({
      availability_verified: true,
      availability_timestamp: '2026-07-22T19:06:00.000Z',
    });
    expect(snapshot.source_timestamps.schedule_of_classes).toBe(
      '2026-07-22T19:06:00.000Z',
    );
    expect(validateCatalogSnapshot(snapshot, config)).toEqual({
      success: true,
      errors: [],
    });
  });

  it('marks coverage incomplete when a configured subject is absent', () => {
    const snapshot = buildTssCatalogSnapshot(
      { ...config, configured_subjects: ['CAT', 'MATH'] },
      [
        {
          ...tssResponse,
          courses: tssResponse.courses.map((course) => ({
            ...course,
            course_title: null,
          })),
        },
      ],
      {
        runId: 'tss-fa26-partial-test',
        generatedAt: '2026-07-21T12:00:00.000Z',
        generalCatalog: {
          sourceTimestamp: '2026-07-20T12:00:00.000Z',
          courses: [],
        },
        gradeArchive: {
          sourceTimestamp: '2026-07-19T12:00:00.000Z',
          records: [],
        },
      },
    );

    expect(snapshot.coverage).toEqual({
      complete: false,
      continuation_needed: true,
    });
    expect(snapshot.courses[0]).toMatchObject({
      course_id: 'CAT:1',
      display_course_code: 'CAT-001',
      title: 'CAT-001',
    });
  });

  it('keeps package seats unknown when any required component is unknown', () => {
    const response = structuredClone(tssResponse);
    const choice = response.courses[0]!.booking_choices[0]!;
    const lecture = choice.components[0]!;
    Object.assign(lecture.enrollment, { seats_available: null });
    choice.components.push({
      ...structuredClone(lecture),
      section_code: '001-001-DI',
      event_id: 'E 00000669',
      enrollment: {
        ...lecture.enrollment,
        seats_available: 16,
      },
    });

    const snapshot = buildTssCatalogSnapshot(config, [response], {
      runId: 'tss-fa26-unknown-component-test',
      generatedAt: '2026-07-21T12:00:00.000Z',
      generalCatalog: {
        sourceTimestamp: '2026-07-20T12:00:00.000Z',
        courses: [],
      },
      gradeArchive: {
        sourceTimestamp: '2026-07-19T12:00:00.000Z',
        records: [],
      },
    });

    expect(snapshot.courses[0]?.sections[0]?.available_seats).toBeNull();
  });

  it('publishes TSS sentinel limits as effectively unbounded availability', () => {
    const response = structuredClone(tssResponse);
    Object.assign(
      response.courses[0]!.booking_choices[0]!.components[0]!.enrollment,
      {
        enrolled: 0,
        capacity: null,
        seats_available: 9999,
      },
    );

    const snapshot = buildTssCatalogSnapshot(config, [response], {
      runId: 'tss-fa26-unbounded-test',
      generatedAt: '2026-07-21T12:00:00.000Z',
      generalCatalog: {
        sourceTimestamp: '2026-07-20T12:00:00.000Z',
        courses: [],
      },
      gradeArchive: {
        sourceTimestamp: '2026-07-19T12:00:00.000Z',
        records: [],
      },
    });

    expect(snapshot.courses[0]?.sections[0]).toMatchObject({
      enrolled: 0,
      capacity: null,
      available_seats: null,
      capacity_kind: 'effectively_unbounded',
      reported_capacity: null,
      reported_seats_available: 9999,
    });
    expect(validateCatalogSnapshot(snapshot, config)).toEqual({
      success: true,
      errors: [],
    });
  });

  it('distinguishes zero offerings from incomplete or omitted requested data', () => {
    const sources = {
      runId: 'tss-fa26-requested-subjects-test',
      generatedAt: '2026-07-21T12:00:00.000Z',
      generalCatalog: {
        sourceTimestamp: '2026-07-20T12:00:00.000Z',
        courses: [],
      },
      gradeArchive: {
        sourceTimestamp: '2026-07-19T12:00:00.000Z',
        records: [],
      },
    };
    const completeSnapshot = buildTssCatalogSnapshot(
      { ...config, configured_subjects: ['CAT', 'MATH'] },
      [
        {
          ...tssResponse,
          requested_course: 'CAT, MATH',
          coverage: { complete: true, continuation_needed: false },
        },
      ],
      sources,
    );
    const incompleteSnapshot = buildTssCatalogSnapshot(
      { ...config, configured_subjects: ['CAT', 'MATH'] },
      [
        {
          ...tssResponse,
          requested_course: 'CAT, MATH',
          coverage: { complete: false, continuation_needed: true },
        },
      ],
      sources,
    );
    const omittedSnapshot = buildTssCatalogSnapshot(
      { ...config, configured_subjects: ['CAT', 'MATH'] },
      [
        {
          ...tssResponse,
          requested_course: 'CAT, MATH',
          coverage: {
            complete: true,
            continuation_needed: false,
            omitted_courses: ['MATH-299'],
          },
        },
      ],
      sources,
    );

    expect(completeSnapshot.coverage).toEqual({
      complete: true,
      continuation_needed: false,
    });
    expect(incompleteSnapshot.coverage).toEqual({
      complete: false,
      continuation_needed: true,
    });
    expect(omittedSnapshot.coverage).toEqual({
      complete: false,
      continuation_needed: true,
    });
  });
});
