import { describe, expect, it } from 'vitest';

import {
  applyTssAvailabilitySupplement,
  parseTssAvailabilitySupplement,
} from './tssAvailabilitySupplement';

describe('TSS availability supplement parser', () => {
  it('normalizes mixed CSV and tab-delimited blocks', () => {
    const records = parseTssAvailabilitySupplement(`
Subject,Course,Section,Type,Instructor,Seats_Total,Seats_Available
CAT,001,001-000-LE,lecture,Phoebe Bronstein,256,216

Subject\tCourse\tSection Code\tSection Name\tSeats Available\tEnrollment\u202fLimit\tStatus
PH\t045\t001‑000‑LE\tPH 045\t120\t140\tAC

Subject,Course,SectionCode,InstructionType,EnrollmentLimit,Enrolled,SeatsAvailable
POLI,102G,001-000-LE,lecture,104,4,100
`);

    expect(records).toEqual([
      {
        subject: 'CAT',
        course: '1',
        sectionCode: '001-000-LE',
        capacity: 256,
        enrolled: null,
        availableSeats: 216,
        capacityKind: 'bounded',
        reportedCapacity: 256,
        reportedAvailableSeats: 216,
        status: 'unknown',
        line: 3,
      },
      {
        subject: 'PH',
        course: '45',
        sectionCode: '001-000-LE',
        capacity: 140,
        enrolled: null,
        availableSeats: 120,
        capacityKind: 'bounded',
        reportedCapacity: 140,
        reportedAvailableSeats: 120,
        status: 'active',
        line: 6,
      },
      {
        subject: 'POLI',
        course: '102G',
        sectionCode: '001-000-LE',
        capacity: 104,
        enrolled: 4,
        availableSeats: 100,
        capacityKind: 'bounded',
        reportedCapacity: 104,
        reportedAvailableSeats: 100,
        status: 'unknown',
        line: 9,
      },
    ]);
  });

  it('preserves source-reported available seats instead of recomputing them', () => {
    const [record] = parseTssAvailabilitySupplement(`
Subject,Course,SectionCode,EnrollmentLimit,Enrolled,SeatsAvailable
CAT,001,001-000-LE,100,20,90
`);

    expect(record).toMatchObject({
      capacity: 100,
      enrolled: 20,
      availableSeats: 90,
    });
  });

  it('recognizes an available-seat sentinel when the capacity is not a sentinel', () => {
    const [record] = parseTssAvailabilitySupplement(`
Subject,Course,SectionCode,EnrollmentLimit,SeatsAvailable
NEUG,299,038-000-IN,100,9999
`);

    expect(record).toMatchObject({
      capacity: null,
      availableSeats: null,
      capacityKind: 'effectively_unbounded',
      reportedCapacity: 100,
      reportedAvailableSeats: 9999,
    });
  });

  it('rejects explicitly inactive supplement rows', () => {
    expect(() =>
      parseTssAvailabilitySupplement(`
Subject,Course,Section Code,Section Name,Seats Available,Enrollment Limit,Status
CAT,001,001-000-LE,CAT 001,90,100,CA
`),
    ).toThrow('line 3 has unsupported status: CA');
  });

  it('rejects malformed data rows instead of silently dropping them', () => {
    expect(() =>
      parseTssAvailabilitySupplement(`
Subject,Course,Section,Type,Instructor,Seats_Total,Seats_Available
CAT,001
`),
    ).toThrow('line 3 has 2 columns; expected at least 7');

    expect(() =>
      parseTssAvailabilitySupplement(`
Subject,Course,Section,Type,Instructor,Seats_Total,Seats_Available
C@T,001,001-000-LE,lecture,Instructor,100,20
`),
    ).toThrow('line 3 has invalid subject: C@T');
  });

  it('skips explicit notes and ellipsis placeholders between data blocks', () => {
    const records = parseTssAvailabilitySupplement(`
Subject\tCourse\tSection Code\tSection Name\tSeats Available\tEnrollment Limit\tStatus
Notes
Seats Available reflects the number of open seats at extract time.
…\t…\t…\t…\t…\t…\t…
PH\t045\t001-000-LE\tPH 045\t120\t140\tAC
`);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ subject: 'PH', course: '45' });
  });

  it('uses matched supplement values as authoritative and audits unmatched rows', () => {
    const records = parseTssAvailabilitySupplement(`
Subject,Course,Section,Type,Instructor,Seats_Total,Seats_Available
LTWL,500,001-000-DI,discussion,Andrea Mendoza,9999,9999
MUS,095G,002-000-ST,studio,Kenneth Anderson,395,395
`);
    const result = applyTssAvailabilitySupplement(
      [
        {
          courses: [
            {
              course_code: '500',
              tss_course_code: 'LTWL-500',
              booking_choices: [
                {
                  components: [
                    {
                      section_code: '001-000-DI',
                      enrollment: {
                        enrolled: 9999,
                        capacity: null,
                        seats_available: null,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      records,
    );

    expect(result).toMatchObject({
      records: 2,
      matchedRecords: 1,
      updatedComponents: 1,
      overriddenValues: 1,
      unmatchedRecords: 1,
      unmatchedKeys: ['MUS:95G:002-000-ST'],
      overrides: [
        {
          key: 'LTWL:500:001-000-DI',
          field: 'enrolled',
          current: 9999,
          next: null,
        },
      ],
      responses: [
        {
          courses: [
            {
              booking_choices: [
                {
                  components: [
                    {
                      enrollment: {
                        enrolled: null,
                        capacity: null,
                        seats_available: null,
                        capacity_kind: 'effectively_unbounded',
                        reported_capacity: 9999,
                        reported_seats_available: 9999,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('preserves an existing enrolled count when the supplement omits it', () => {
    const records = parseTssAvailabilitySupplement(`
Subject,Course,Section,Type,Instructor,Seats_Total,Seats_Available
CAT,001,001-000-LE,lecture,Phoebe Bronstein,100,90
`);
    const result = applyTssAvailabilitySupplement(
      [
        {
          courses: [
            {
              course_code: '001',
              tss_course_code: 'CAT-001',
              booking_choices: [
                {
                  components: [
                    {
                      section_code: '001-000-LE',
                      enrollment: {
                        enrolled: 25,
                        capacity: null,
                        seats_available: null,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      records,
    );

    expect(
      result.responses[0]?.courses[0]?.booking_choices[0]?.components[0]
        ?.enrollment.enrolled,
    ).toBe(25);
  });
});
