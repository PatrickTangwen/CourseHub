import { describe, expect, it } from 'vitest';

import {
  parseTssExamMeetings,
  repairTssExamMeetings,
  type RawMeeting,
} from './tssExamMeetingRepair';

const enrollment = {
  enrolled: 0,
  capacity: 26,
  seats_available: 26,
  waitlist: { state: 'not_shown', count: null },
};

function response(meetings: RawMeeting[]) {
  return {
    schema_version: 'tss-chatbot-v1',
    term: 'FA26',
    courses: [
      {
        course_code: '010AD',
        course_title: 'First-Yr Chinese/Dialect I',
        tss_course_code: 'CHIN-010AD',
        booking_choices: [
          {
            booking_choice_ordinal: 1,
            displayed_package_section: null,
            displayed_package_id: null,
            final_exam_date: null,
            components: [
              {
                type: 'lecture',
                section_code: '001-000-LE',
                event_id: 'E 00002294',
                requirement: 'required',
                meetings,
                enrollment,
              },
            ],
          },
        ],
      },
    ],
  };
}

const classMeeting = {
  meeting_kind: 'class',
  specific_date: null,
  days: 'T',
  start_time: '9:30am',
  end_time: '10:50am',
  location_displayed: 'CENTR 201',
  instructor: 'Mingming Liu',
  is_tba: false,
  is_arranged: null,
};

describe('TSS exam meeting repair', () => {
  it('parses compact TSS Final rows and replaces their placeholder TBA rows', () => {
    const source = [
      'term_code,subject_code,course_code,class_name,course_title,section_code,section_ref,section_id,instruction_type_name,instructors_text,enrollment_limit,enrolled_quantity,waitlist_capacity,waitlist_enrolled,available_seats,waitlist_available,status,meeting_kind,day_code,specific_date,start_time_display,end_time_display,building_code,room_code,is_remote,is_tba',
      'FA26,CHIN,010AD,CHIN 010AD,First-Yr Chinese/Dialect I,001-000-LE,FA26:E 00002294,E 00002294,final,R,2026-12-10,8:00am,10:59am,CENTR,CENTR 201,0,0',
    ].join('\n');
    const input = response([
      classMeeting,
      {
        ...classMeeting,
        meeting_kind: '',
        specific_date: null,
        days: null,
        start_time: 'tba',
        end_time: 'tba',
        location_displayed: null,
      },
    ]);

    const result = repairTssExamMeetings(input, parseTssExamMeetings(source));

    expect(result.repairedComponents).toBe(1);
    expect(result.replacedMeetings).toBe(1);
    expect(input.courses[0]!.booking_choices[0]!.final_exam_date).toBe(
      '2026-12-10',
    );
    expect(
      input.courses[0]!.booking_choices[0]!.components[0]!.meetings,
    ).toEqual([
      classMeeting,
      {
        meeting_kind: 'final',
        specific_date: '2026-12-10',
        days: 'R',
        start_time: '8:00am',
        end_time: '10:59am',
        location_displayed: 'CENTR 201',
        instructor: 'Mingming Liu',
        is_tba: false,
        is_arranged: null,
      },
    ]);
  });

  it('parses expanded MATH Midterm rows and realigns shifted meeting fields', () => {
    const source = [
      'Subject,CourseNumber,SectionCode,SectionID,MeetingType,Days,StartTime,EndTime,Building,Room,Instructor,SeatsAvailable,Capacity,WaitlistCapacity,WaitlistEnrolled,Cancelled,SpecificDate',
      'MATH,010A,001-000-LE,E 00001496,lecture,midterm,F,6:00pm,6:50pm,CENTR,CENTR 115,Adam Bowers,18,18,,0,2026-10-23',
    ].join('\n');
    const input = response([
      classMeeting,
      {
        ...classMeeting,
        specific_date: '2026-10-23',
        days: 'midterm',
        start_time: 'F',
        end_time: '6:00pm',
        location_displayed: 'CENTR',
        instructor: 'CENTR 115',
      },
    ]);
    Object.assign(input.courses[0]!, {
      course_code: '010A',
      course_title: 'Calculus I',
      tss_course_code: 'MATH-010A',
    });
    const component = input.courses[0]!.booking_choices[0]!.components[0]!;
    component.event_id = 'E 00001496';

    repairTssExamMeetings(input, parseTssExamMeetings(source));

    expect(component.meetings).toEqual([
      classMeeting,
      {
        meeting_kind: 'midterm',
        specific_date: '2026-10-23',
        days: 'F',
        start_time: '6:00pm',
        end_time: '6:50pm',
        location_displayed: 'CENTR 115',
        instructor: 'Adam Bowers',
        is_tba: false,
        is_arranged: null,
      },
    ]);
  });

  it('preserves genuine TBA class meetings next to a scheduled Final', () => {
    const source = [
      'Subject,CourseNumber,SectionCode,SectionID,MeetingType,Days,StartTime,EndTime,Building,Room,Instructor,SeatsAvailable,Capacity,WaitlistCapacity,WaitlistEnrolled,Cancelled,SpecificDate',
      'MUS,020R,001-000-LE,E 00009999,lecture,final,M,8:00am,10:59am,MOS,MOS 0113,Instructor,20,20,,0,2026-12-07',
    ].join('\n');
    const genuineTba = {
      ...classMeeting,
      days: null,
      start_time: 'tba',
      end_time: 'tba',
      location_displayed: 'tba',
      is_tba: true,
    };
    const existingFinal = {
      ...classMeeting,
      meeting_kind: 'final',
      specific_date: '2026-12-07',
      days: 'M',
      start_time: '8:00am',
      end_time: '10:59am',
      location_displayed: 'MOS 0113',
      instructor: 'Instructor',
    };
    const input = response([genuineTba, existingFinal]);
    Object.assign(input.courses[0]!, {
      course_code: '020R',
      tss_course_code: 'MUS-020R',
    });
    const component = input.courses[0]!.booking_choices[0]!.components[0]!;
    component.event_id = 'E 00009999';

    repairTssExamMeetings(input, parseTssExamMeetings(source));

    expect(component.meetings).toEqual([genuineTba, existingFinal]);
  });

  it('fails closed when the source exams do not match repairable raw meetings', () => {
    const source = [
      'Subject,CourseNumber,SectionCode,SectionID,MeetingType,Days,StartTime,EndTime,Building,Room,Instructor,SeatsAvailable,Capacity,WaitlistCapacity,WaitlistEnrolled,Cancelled,SpecificDate',
      'CHIN,010AD,001-000-LE,E 00002294,lecture,final,R,8:00am,10:59am,CENTR,CENTR 201,Mingming Liu,26,26,,0,2026-12-10',
    ].join('\n');
    const input = response([classMeeting]);

    expect(() =>
      repairTssExamMeetings(input, parseTssExamMeetings(source)),
    ).toThrow(/expected 1 existing exam representation/u);
  });

  it('fails closed when an exam-like source row has an unknown shape', () => {
    const source = [
      'Subject,CourseNumber,SectionCode,SectionID,MeetingType,Days',
      'MATH,010A,001-000-LE,E 00001496,final',
    ].join('\n');

    expect(() => parseTssExamMeetings(source)).toThrow(
      /Unrecognized TSS final row/u,
    );
  });
});
