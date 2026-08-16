import { z } from 'zod';

import {
  attachGeneralCatalogMetadata,
  attachGradeArchiveRecords,
  type CatalogSnapshot,
  type CatalogSnapshotConfig,
} from './catalogSnapshot';
import type { GeneralCatalogCourse } from './generalCatalog';
import type { GradeArchiveRecord } from './instructorGradeArchive';
import {
  buildScheduleCatalogSnapshot,
  type ParsedScheduleOfClasses,
} from './scheduleOfClasses';
import {
  normalizeTssMeetingDays,
  normalizeTssMeetingLocation,
} from '../../shared/tssMeetingDays.js';

const meetingSchema = z.object({
  meeting_kind: z.string(),
  specific_date: z.string().nullable(),
  days: z.string().nullable(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  location_displayed: z.string().nullable(),
  instructor: z.string().nullable(),
  is_remote: z.boolean().optional().default(false),
  is_tba: z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(Boolean),
  is_arranged: z.boolean().nullable(),
});

const componentSchema = z.object({
  type: z.string(),
  section_code: z.string(),
  event_id: z.string(),
  requirement: z.string(),
  instructors_text: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  is_cancelled: z.boolean().optional().default(false),
  meetings: z.array(meetingSchema),
  enrollment: z.object({
    enrolled: z.number().nullable(),
    capacity: z.number().nullable(),
    seats_available: z.number().nullable(),
    capacity_kind: z.enum(['bounded', 'effectively_unbounded']).optional(),
    reported_capacity: z.number().nullable().optional(),
    reported_seats_available: z.number().nullable().optional(),
    waitlist: z.object({
      state: z.string(),
      count: z.number().nullable(),
      capacity: z.number().nullable().optional(),
      available_spots: z.number().nullable().optional(),
    }),
  }),
});

const bookingChoiceSchema = z.object({
  booking_choice_ordinal: z.number().int().positive(),
  displayed_package_section: z.string().nullable(),
  displayed_package_id: z.string().nullable(),
  components: z.array(componentSchema).min(1),
});

const tssResponseSchema = z.object({
  schema_version: z.literal('tss-chatbot-v1'),
  term: z.string().min(1),
  requested_course: z.string().min(1).optional(),
  source_metadata: z.object({
    last_refreshed_displayed: z.string().nullable(),
    captured_at: z.string().optional(),
    availability_observed_at: z.string().optional(),
  }),
  coverage: z.object({
    complete: z.boolean(),
    continuation_needed: z.boolean(),
    omitted_courses: z.array(z.string().min(1)).optional(),
  }),
  courses: z.array(
    z.object({
      course_code: z.string().min(1),
      course_title: z.string().min(1).nullable(),
      tss_course_code: z.string().min(1),
      booking_choices: z.array(bookingChoiceSchema),
    }),
  ),
});

type TssResponse = z.infer<typeof tssResponseSchema>;
type TssCourse = TssResponse['courses'][number];
type BookingChoice = TssCourse['booking_choices'][number];
type TssComponent = BookingChoice['components'][number];
type TssMeeting = TssComponent['meetings'][number];
type SnapshotCourse = CatalogSnapshot['courses'][number];
type SnapshotSection = SnapshotCourse['sections'][number];
type SnapshotMeeting = SnapshotSection['meetings'][number];

export type TssCatalogSnapshotSources = {
  runId?: string;
  generatedAt?: string;
  generalCatalog: {
    sourceTimestamp: string | null;
    courses: GeneralCatalogCourse[];
  };
  gradeArchive: {
    sourceTimestamp: string | null;
    records: GradeArchiveRecord[];
  };
};

export function parseTssRequestedSubjects(value?: string): string[] {
  return (value ?? '')
    .split(/[^A-Za-z\d]+/u)
    .map((subject) => subject.trim().toUpperCase())
    .filter(Boolean);
}

const dayNames: { [day: string]: string } = {
  F: 'Friday',
  M: 'Monday',
  R: 'Thursday',
  S: 'Saturday',
  T: 'Tuesday',
  U: 'Sunday',
  W: 'Wednesday',
};

const rawDayNames: { [day: string]: string } = {
  F: 'F',
  M: 'M',
  R: 'Th',
  S: 'Sa',
  T: 'Tu',
  U: 'Su',
  W: 'W',
};

const meetingTypeLabels: { [type: string]: string } = {
  cl: 'Clinical',
  discussion: 'Discussion',
  fw: 'Fieldwork',
  in: 'Independent Study',
  'independent study': 'Independent Study',
  lab: 'Laboratory',
  lecture: 'Lecture',
  pr: 'Practicum',
  se: 'Seminar',
  studio: 'Studio',
  tu: 'Tutorial',
};

function sourceIdentifier(value: string): string {
  return value.trim().replace(/\s+/gu, '');
}

function normalizeCourseNumber(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/^0+(?=\d)/u, '');
}

function courseIdentity(course: TssCourse) {
  const separator = course.tss_course_code.indexOf('-');
  const subject = (
    separator >= 0
      ? course.tss_course_code.slice(0, separator)
      : course.tss_course_code
  )
    .trim()
    .toUpperCase();
  const courseNumber = normalizeCourseNumber(
    separator >= 0
      ? course.tss_course_code.slice(separator + 1)
      : course.course_code,
  );
  return {
    subject,
    courseNumber,
    courseId: `${subject}:${courseNumber}`,
  };
}

export function tssCourseIds(responses: unknown[]): Set<string> {
  return new Set(
    responses.flatMap((response) =>
      tssResponseSchema
        .parse(response)
        .courses.map((course) => courseIdentity(course).courseId),
    ),
  );
}

function sectionId(
  term: string,
  course: TssCourse,
  choice: BookingChoice,
): string {
  if (choice.displayed_package_id)
    return `${term}:${sourceIdentifier(choice.displayed_package_id)}`;
  const componentIds = choice.components.map((component) =>
    sourceIdentifier(component.event_id),
  );
  return `${term}:${sourceIdentifier(course.tss_course_code)}:${componentIds.join('+')}`;
}

function sectionCode(choice: BookingChoice): string {
  return (
    choice.displayed_package_section ??
    choice.components.map((component) => component.section_code).join(' + ')
  );
}

function sectionMeetingType(choice: BookingChoice): string {
  const types = new Set(choice.components.map((component) => component.type));
  if (types.size !== 1) return 'Package';
  const [type = 'Meeting'] = types;
  return type.length <= 3 ? type.toUpperCase() : type;
}

function dayTokens(value: string | null): string[] {
  return (value ?? '')
    .trim()
    .split(/\s+/u)
    .filter((day) => Boolean(dayNames[day]));
}

function time24(value: string | null): string | null {
  if (!value) return null;
  const match = /^(?<hour>\d{1,2}):(?<minute>\d{2})(?<period>am|pm)$/iu.exec(
    value.trim(),
  );
  const hourText = match?.groups?.hour;
  const minute = match?.groups?.minute;
  const period = match?.groups?.period?.toLowerCase();
  if (!hourText || !minute || !period) return null;
  let hour = Number(hourText) % 12;
  if (period === 'pm') hour += 12;
  return `${String(hour).padStart(2, '0')}:${minute}`;
}

function toMeeting(
  component: TssComponent,
  meeting: TssMeeting,
): SnapshotMeeting {
  const tokens = dayTokens(meeting.days);
  const startTime = time24(meeting.start_time);
  const endTime = time24(meeting.end_time);
  const { building, room, rawLocation } = normalizeTssMeetingLocation(meeting);
  const meetingType =
    meeting.meeting_kind === 'final'
      ? 'Final'
      : meeting.meeting_kind === 'midterm'
        ? 'Midterm'
        : (meetingTypeLabels[component.type.toLowerCase()] ?? component.type);
  return {
    days: tokens.map((day) => dayNames[day]!),
    date: meeting.specific_date,
    start_time: startTime,
    end_time: endTime,
    building,
    room,
    is_tba:
      meeting.is_tba ||
      meeting.is_arranged === true ||
      !startTime ||
      !endTime ||
      (!meeting.specific_date && tokens.length === 0),
    meeting_type: meetingType,
    raw_days: tokens.map((day) => rawDayNames[day]).join('') || null,
    raw_time:
      meeting.start_time && meeting.end_time
        ? `${meeting.start_time}-${meeting.end_time}`
        : null,
    raw_location: rawLocation,
  };
}

function choiceEnrollment(choice: BookingChoice) {
  const required = choice.components.filter(
    (component) => component.requirement === 'required',
  );
  const components = required.length ? required : choice.components;
  const isUnbounded = (component: TssComponent) =>
    component.enrollment.capacity_kind === 'effectively_unbounded' ||
    component.enrollment.capacity === 9999 ||
    component.enrollment.capacity === 99999 ||
    component.enrollment.seats_available === 9999 ||
    component.enrollment.seats_available === 99999;
  const allSeatsKnown = components.every(
    (component) =>
      isUnbounded(component) || component.enrollment.seats_available !== null,
  );
  const boundedComponents = components.filter(
    (component) => !isUnbounded(component),
  );
  const limiting = (
    allSeatsKnown ? boundedComponents : []
  ).reduce<TssComponent | null>((current, item) => {
    if (!current) return item;
    return item.enrollment.seats_available! <
      current.enrollment.seats_available!
      ? item
      : current;
  }, null);
  const waitlistCounts = components.flatMap((component) => {
    const { count } = component.enrollment.waitlist;
    return count === null ? [] : [count];
  });
  const allUnbounded =
    allSeatsKnown && components.every((component) => isUnbounded(component));
  const reportedUnbounded = allUnbounded ? components[0] : null;
  const unboundedEnrolled = allUnbounded
    ? components
        .map((component) => component.enrollment.enrolled)
        .filter(
          (value): value is number =>
            value !== null && value !== 9999 && value !== 99999,
        )
    : [];
  return {
    enrolled: allUnbounded
      ? unboundedEnrolled.length
        ? Math.max(...unboundedEnrolled)
        : null
      : (limiting?.enrollment.enrolled ?? null),
    capacity: allUnbounded ? null : (limiting?.enrollment.capacity ?? null),
    availableSeats: allUnbounded
      ? null
      : (limiting?.enrollment.seats_available ?? null),
    capacityKind: allUnbounded
      ? ('effectively_unbounded' as const)
      : limiting
        ? ('bounded' as const)
        : undefined,
    reportedCapacity: reportedUnbounded
      ? (reportedUnbounded.enrollment.reported_capacity ??
        reportedUnbounded.enrollment.capacity)
      : undefined,
    reportedSeatsAvailable: reportedUnbounded
      ? (reportedUnbounded.enrollment.reported_seats_available ??
        reportedUnbounded.enrollment.seats_available)
      : undefined,
    waitlistCount: waitlistCounts.length ? Math.max(...waitlistCounts) : null,
  };
}

function toSection(
  catalog: TssResponse,
  course: TssCourse,
  choice: BookingChoice,
): SnapshotSection {
  const enrollment = choiceEnrollment(choice);
  const availabilityTimestamp =
    catalog.source_metadata.last_refreshed_displayed ??
    catalog.source_metadata.availability_observed_at ??
    null;
  const instructors = [
    ...new Set(
      choice.components.flatMap((component) => [
        ...(component.instructors_text ? [component.instructors_text] : []),
        ...component.meetings.flatMap((meeting) =>
          meeting.instructor ? [meeting.instructor] : [],
        ),
      ]),
    ),
  ];
  return {
    section_id: sectionId(catalog.term, course, choice),
    course_id: courseIdentity(course).courseId,
    section_code: sectionCode(choice),
    meeting_type: sectionMeetingType(choice),
    instructors,
    meetings: choice.components.flatMap((component) =>
      normalizeTssMeetingDays(catalog.term, component.meetings).map((meeting) =>
        toMeeting(component, meeting),
      ),
    ),
    enrolled: enrollment.enrolled,
    capacity: enrollment.capacity,
    available_seats: enrollment.availableSeats,
    capacity_kind: enrollment.capacityKind,
    reported_capacity: enrollment.reportedCapacity,
    reported_seats_available: enrollment.reportedSeatsAvailable,
    waitlist_count: enrollment.waitlistCount,
    availability_verified: Boolean(availabilityTimestamp),
    availability_timestamp: availabilityTimestamp,
    raw: {
      source: 'ucsd_tss',
      tss_course_code: course.tss_course_code,
      tss_event_ids: choice.components.map((component) => component.event_id),
      tss_component_statuses: choice.components.flatMap((component) =>
        component.status
          ? [
              {
                event_id: component.event_id,
                status: component.status,
                is_cancelled: component.is_cancelled,
              },
            ]
          : [],
      ),
      tss_waitlist_capacity: choice.components.flatMap((component) => {
        const { capacity } = component.enrollment.waitlist;
        return capacity === null || capacity === undefined
          ? []
          : [{ event_id: component.event_id, capacity }];
      }),
      tss_waitlist_available: choice.components.flatMap((component) => {
        const availableSpots = component.enrollment.waitlist.available_spots;
        return availableSpots === null || availableSpots === undefined
          ? []
          : [{ event_id: component.event_id, available_spots: availableSpots }];
      }),
    },
  };
}

function toCourse(catalog: TssResponse, course: TssCourse): SnapshotCourse {
  const { subject, courseNumber, courseId } = courseIdentity(course);
  const courseCode =
    catalog.term === 'FA26'
      ? sourceIdentifier(course.tss_course_code)
      : `${subject} ${courseNumber}`;
  return {
    course_id: courseId,
    subject,
    course_number: courseNumber,
    display_course_code: catalog.term === 'FA26' ? courseCode : undefined,
    title: course.course_title ?? courseCode,
    units: null,
    description: null,
    prerequisites_text: null,
    restrictions_text: null,
    catalog_url: null,
    archive_avg_gpa: null,
    archive_record_count: 0,
    grade_archive_records: [],
    ge_matches: [],
    sections: course.booking_choices.map((choice) =>
      toSection(catalog, course, choice),
    ),
  };
}

function parseTssResponse(
  value: unknown,
  generatedAt: string,
): ParsedScheduleOfClasses[] {
  const catalog = tssResponseSchema.parse(value);
  const coursesBySubject = Map.groupBy(
    catalog.courses,
    (course) => courseIdentity(course).subject,
  );
  return [...coursesBySubject].map(([subject, courses]) => ({
    subject,
    term: catalog.term,
    source_url: 'tss-chatbot-v1',
    fetched_at: generatedAt,
    source_timestamp:
      catalog.source_metadata.last_refreshed_displayed ??
      catalog.source_metadata.availability_observed_at ??
      null,
    courses: courses.map((course) => toCourse(catalog, course)),
  }));
}

function snapshotCoverage(responses: unknown[], configuredSubjects: string[]) {
  const parsed = responses.map((response) => tssResponseSchema.parse(response));
  const coveredSubjects = new Set(
    parsed.flatMap((response) => {
      const isComplete =
        response.coverage.complete &&
        !response.coverage.continuation_needed &&
        (response.coverage.omitted_courses?.length ?? 0) === 0;
      if (!isComplete) return [];
      return [
        ...response.courses.map((course) => courseIdentity(course).subject),
        ...parseTssRequestedSubjects(response.requested_course),
      ];
    }),
  );
  const missingConfiguredSubject = configuredSubjects.some(
    (subject) => !coveredSubjects.has(subject),
  );
  return {
    complete: !missingConfiguredSubject,
    continuation_needed: missingConfiguredSubject,
  };
}

function sharedSourceTimestamp(
  parsedSubjects: ParsedScheduleOfClasses[],
): string | null {
  const timestamps = new Set(
    parsedSubjects.map((parsed) => parsed.source_timestamp),
  );
  if (timestamps.size !== 1) return null;
  return timestamps.values().next().value ?? null;
}

/**
 * Converts raw TSS schedule responses into the same self-contained Published
 * Snapshot contract used by every term. Catalog and grade data are joined by
 * canonical Course ID before the artifact reaches the frontend.
 */
export function buildTssCatalogSnapshot(
  config: CatalogSnapshotConfig,
  responses: unknown[],
  sources: TssCatalogSnapshotSources,
): CatalogSnapshot {
  const generatedAt = sources.generatedAt ?? new Date().toISOString();
  const parsedSubjects = responses.flatMap((response) =>
    parseTssResponse(response, generatedAt),
  );
  for (const parsed of parsedSubjects) {
    if (parsed.term !== config.active_planning_term) {
      throw new Error(
        `TSS term ${parsed.term} does not match ${config.active_planning_term}`,
      );
    }
  }

  const scheduleSnapshot = buildScheduleCatalogSnapshot(
    config,
    parsedSubjects,
    { runId: sources.runId, generatedAt },
  );
  const enriched = attachGradeArchiveRecords(
    attachGeneralCatalogMetadata(
      scheduleSnapshot,
      sources.generalCatalog.courses,
    ),
    sources.gradeArchive.records,
  );
  return {
    ...enriched,
    coverage: snapshotCoverage(responses, config.configured_subjects),
    source_timestamps: {
      schedule_of_classes: sharedSourceTimestamp(parsedSubjects),
      general_catalog: sources.generalCatalog.sourceTimestamp,
      instructor_grade_archive: sources.gradeArchive.sourceTimestamp,
    },
  };
}
