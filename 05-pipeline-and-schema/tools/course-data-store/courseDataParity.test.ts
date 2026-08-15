import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { projectPublishedSnapshot } from './courseDataParity.js';
import { compareCourseDataParity } from './courseDataParityComparator.js';

const expected = {
  courses: new Map([
    ['CSE:100', { courseId: 'CSE:100', title: 'Advanced Data Structures' }],
  ]),
  sectionInstructors: new Map([
    ['S326:123:Staff', { sectionId: 'S326:123', instructorName: 'Staff' }],
  ]),
};

describe('Course Data Store semantic parity comparator', () => {
  it('accepts equal domain projections regardless of insertion order', () => {
    const actual = {
      sectionInstructors: new Map([...expected.sectionInstructors].reverse()),
      courses: new Map([...expected.courses].reverse()),
    };

    expect(compareCourseDataParity(expected, actual)).toEqual({
      matches: true,
      mismatchCount: 0,
      mismatches: [],
      truncated: false,
    });
  });

  it('ignores JSON object key order while preserving array semantics', () => {
    const left = { records: new Map([['one', { raw: { b: 2, a: [1, 2] } }]]) };
    const right = { records: new Map([['one', { raw: { a: [1, 2], b: 2 } }]]) };

    expect(compareCourseDataParity(left, right).matches).toBe(true);
    expect(
      compareCourseDataParity(left, {
        records: new Map([['one', { raw: { a: [2, 1], b: 2 } }]]),
      }).matches,
    ).toBe(false);
  });

  it('treats Meeting and Grade Archive Record ordering as transport-only', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'parity-order-'));
    const manifestPath = path.join(directory, 'manifest.json');
    await writeFile(
      manifestPath,
      JSON.stringify({
        summary: { ok: 0, empty: 0, failed: 0, partial: 0 },
        cells: [],
      }),
    );
    const record = (name: string) => ({
      subject: 'CSE',
      course: '100',
      year: '26',
      quarter: 'SP',
      title: name,
      instructor: name,
      gpa: 4,
      a: 100,
      b: 0,
      c: 0,
      d: 0,
      f: 0,
      w: 0,
      p: 0,
      np: 0,
      raw: { name },
      matched_via: 'cross_listed',
    });
    const meeting = (room: string) => ({
      days: ['M'],
      date: null,
      start_time: '09:00',
      end_time: '09:50',
      building: 'CENTR',
      room,
      is_tba: false,
      meeting_type: 'LE',
      raw_days: 'M',
      raw_time: '09:00-09:50',
      raw_location: `CENTR ${room}`,
    });
    const snapshot = (reversed: boolean) => ({
      run_id: 'order-test',
      generated_at: '2026-04-01T00:00:00.000Z',
      active_planning_term: 'SP26',
      term_label: 'Spring 2026',
      term_date_range: { start: '2026-03-01', end: '2026-06-30' },
      source_timestamps: {
        schedule_of_classes: 'source',
        general_catalog: 'source',
        instructor_grade_archive: 'source',
      },
      courses: [
        {
          course_id: 'CSE:100',
          subject: 'CSE',
          course_number: '100',
          title: 'Course',
          units: '4',
          description: null,
          prerequisites_text: null,
          restrictions_text: null,
          catalog_url: null,
          grade_archive_records: reversed
            ? [record('B'), record('A')]
            : [record('A'), record('B')],
          sections: [
            {
              section_id: 'SP26:1',
              course_id: 'CSE:100',
              section_code: 'A01',
              meeting_type: 'LE',
              instructors: [],
              enrolled: 1,
              capacity: 2,
              waitlist_count: 0,
              meetings: reversed
                ? [meeting('102'), meeting('101')]
                : [meeting('101'), meeting('102')],
            },
          ],
        },
      ],
    });
    const leftPath = path.join(directory, 'left.json');
    const rightPath = path.join(directory, 'right.json');
    await Promise.all([
      writeFile(leftPath, JSON.stringify(snapshot(false))),
      writeFile(rightPath, JSON.stringify(snapshot(true))),
    ]);
    const [left, right] = await Promise.all([
      projectPublishedSnapshot(leftPath, manifestPath),
      projectPublishedSnapshot(rightPath, manifestPath),
    ]);

    expect([...left.gradeArchiveRecords!.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ matchedVia: 'cross_listed' }),
      ]),
    );

    expect(
      compareCourseDataParity(
        {
          meetings: left.meetings!,
          gradeArchiveRecords: left.gradeArchiveRecords!,
        },
        {
          meetings: right.meetings!,
          gradeArchiveRecords: right.gradeArchiveRecords!,
        },
      ).matches,
    ).toBe(true);
    await rm(directory, { force: true, recursive: true });
  });

  it.each([
    {
      name: 'missing stable identity',
      actual: { ...expected, courses: new Map() },
      expectedMismatch: {
        category: 'courses',
        identity: 'CSE:100',
        field: 'identity',
        kind: 'missing',
      },
    },
    {
      name: 'extra relationship',
      actual: {
        ...expected,
        sectionInstructors: new Map([
          ...expected.sectionInstructors,
          [
            'S326:123:Extra',
            { sectionId: 'S326:123', instructorName: 'Extra' },
          ],
        ]),
      },
      expectedMismatch: {
        category: 'sectionInstructors',
        identity: 'S326:123:Extra',
        field: 'identity',
        kind: 'extra',
      },
    },
    {
      name: 'material field change',
      actual: {
        ...expected,
        courses: new Map([
          ['CSE:100', { courseId: 'CSE:100', title: 'Changed' }],
        ]),
      },
      expectedMismatch: {
        category: 'courses',
        identity: 'CSE:100',
        field: 'title',
        kind: 'changed',
      },
    },
  ])(
    'reports bounded grouped evidence for $name',
    ({ actual, expectedMismatch }) => {
      const result = compareCourseDataParity(expected, actual, 1);

      expect(result.matches).toBe(false);
      expect(result.mismatchCount).toBe(1);
      expect(result.mismatches).toEqual([expectedMismatch]);
      expect(JSON.stringify(result)).not.toContain('Advanced Data Structures');
    },
  );
});
