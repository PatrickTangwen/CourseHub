import { describe, expect, it } from 'vitest';

import {
  applyModuleCapacitiesByOrderedSectionEvidence,
  parseModuleCapacityCsv,
} from './tssCapacityHierarchy';

function component(sectionCode: string, availableSeats: number | null) {
  return {
    section_code: sectionCode,
    enrollment: {
      enrolled: null,
      capacity: null,
      seats_available: availableSeats,
    },
  };
}

function response(courses: unknown[]) {
  return { courses };
}

describe('TritonGPT module capacity hierarchy', () => {
  it('maps unique course components and updates repeated occurrences', () => {
    const shared = component('001-000-LE', 75);
    const result = applyModuleCapacitiesByOrderedSectionEvidence(
      response([
        {
          tss_course_code: 'AAS-010R',
          booking_choices: [
            {
              components: [shared, component('001-001-DI', 38)],
            },
            {
              components: [shared, component('001-002-DI', 37)],
            },
          ],
        },
      ]),
      parseModuleCapacityCsv(`module_code,capacity
AAS-010R,75
AAS-010R,38
AAS-010R,37
`),
    );

    expect(result.report).toMatchObject({
      matchedByOrderedSectionEvidence: 1,
      matchedUniqueComponents: 3,
      updatedComponentOccurrences: 4,
      skippedCourses: [],
    });
    expect(
      result.response.courses[0]?.booking_choices.map((choice) =>
        choice.components.map((item) => item.enrollment.capacity),
      ),
    ).toEqual([
      [75, 38],
      [75, 37],
    ]);
  });

  it('fails closed for row-count and value conflicts', () => {
    const result = applyModuleCapacitiesByOrderedSectionEvidence(
      response([
        {
          tss_course_code: 'BGGN-271',
          booking_choices: [
            { components: [component('001-000-IN', null)] },
            { components: [component('002-000-IN', null)] },
          ],
        },
        {
          tss_course_code: 'CHEM-006B',
          booking_choices: [{ components: [component('001-000-LE', 144)] }],
        },
        {
          tss_course_code: 'MATH-100A',
          booking_choices: [{ components: [component('001-000-LE', null)] }],
        },
      ]),
      parseModuleCapacityCsv(`module_code,capacity
BGGN-271,9999
CHEM-006B,143
MATH-100A,25
`),
    );

    expect(result.report.skippedCourses).toEqual([
      {
        course: 'BGGN-271',
        reason: 'row_count_mismatch',
        hierarchyRows: 2,
        capacityRows: 1,
        hierarchySections: ['001-000-IN', '002-000-IN'],
        capacityValues: [9999],
      },
      {
        course: 'CHEM-006B',
        reason: 'value_conflict',
        hierarchyRows: 1,
        capacityRows: 1,
        details: ['001-000-LE: available seats 144 != candidate capacity 143'],
      },
      {
        course: 'MATH-100A',
        reason: 'value_conflict',
        hierarchyRows: 1,
        capacityRows: 1,
        details: ['001-000-LE: available seats null != candidate capacity 25'],
      },
    ]);
    expect(result.report.matchedByOrderedSectionEvidence).toBe(0);
  });

  it('preserves effectively-unbounded capacity semantics', () => {
    const result = applyModuleCapacitiesByOrderedSectionEvidence(
      response([
        {
          tss_course_code: 'BNFO-299',
          booking_choices: [
            {
              components: [
                {
                  section_code: '001-000-IN',
                  enrollment: {
                    enrolled: null,
                    capacity: null,
                    seats_available: null,
                    capacity_kind: 'effectively_unbounded',
                    reported_seats_available: 9999,
                  },
                },
              ],
            },
          ],
        },
      ]),
      parseModuleCapacityCsv(`module_code,capacity
BNFO-299,9999
`),
    );

    expect(
      result.response.courses[0]?.booking_choices[0]?.components[0]?.enrollment,
    ).toMatchObject({
      capacity: null,
      capacity_kind: 'effectively_unbounded',
      reported_capacity: 9999,
    });
  });
});
