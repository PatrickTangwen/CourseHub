import { describe, expect, it } from 'vitest';

import { splitPublishedCatalogPayload } from '../../shared/catalogPayload.js';

describe('Published Catalog payload split', () => {
  it('keeps list fields separate from term-scoped Past Grades details', () => {
    const snapshot = {
      run_id: 'run-payload-split',
      generated_at: '2026-07-22T12:00:00.000Z',
      active_planning_term: 'FA26',
      term_label: 'Fall 2026',
      courses: [
        {
          course_id: 'CSE:100',
          title: 'Advanced Data Structures',
          archive_record_count: 1,
          grade_archive_records: [
            {
              year: '25',
              quarter: 'FA',
              instructor: 'Ada Lovelace',
              gpa: 3.8,
            },
          ],
          sections: [{ section_id: 'FA26:CSE-100:A00' }],
        },
        {
          course_id: 'MATH:20C',
          title: 'Calculus',
          archive_record_count: 0,
          grade_archive_records: [],
          sections: [{ section_id: 'FA26:MATH-20C:A00' }],
        },
      ],
    };

    const { listPayload, detailPayload } =
      splitPublishedCatalogPayload(snapshot);

    expect(listPayload).toEqual({
      ...snapshot,
      courses: [
        {
          course_id: 'CSE:100',
          title: 'Advanced Data Structures',
          archive_record_count: 1,
          sections: [{ section_id: 'FA26:CSE-100:A00' }],
        },
        {
          course_id: 'MATH:20C',
          title: 'Calculus',
          archive_record_count: 0,
          sections: [{ section_id: 'FA26:MATH-20C:A00' }],
        },
      ],
    });
    expect(detailPayload).toEqual({
      run_id: 'run-payload-split',
      generated_at: '2026-07-22T12:00:00.000Z',
      active_planning_term: 'FA26',
      courses: [
        {
          course_id: 'CSE:100',
          grade_archive_records: [
            {
              year: '25',
              quarter: 'FA',
              instructor: 'Ada Lovelace',
              gpa: 3.8,
            },
          ],
        },
        {
          course_id: 'MATH:20C',
          grade_archive_records: [],
        },
      ],
    });
    expect(snapshot.courses[0]).toHaveProperty('grade_archive_records');
  });
});
