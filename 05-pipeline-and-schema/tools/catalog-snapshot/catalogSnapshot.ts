import { readFile } from 'node:fs/promises';
import pathModule from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import {
  crossListedCourseIds,
  type GeneralCatalogCourse,
} from './generalCatalog';
import type { GradeArchiveRecord } from './instructorGradeArchive';
import {
  createFileSnapshotStorage,
  type SnapshotStorage,
} from './snapshotStorage';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const termCodeSchema = z
  .string()
  .min(1)
  .regex(/^[\w-]+$/u);
const termDateRangeSchema = z
  .object({
    start: dateSchema,
    end: dateSchema,
  })
  .strict()
  .nullable();

export const catalogSnapshotConfigSchema = z
  .object({
    active_planning_term: termCodeSchema,
    term_label: z.string().min(1),
    term_date_range: termDateRangeSchema,
    term_date_ranges: z.record(termDateRangeSchema).optional(),
    configured_subjects: z.array(z.string().min(1)).min(1),
    paths: z
      .object({
        raw_dir: z.string().min(1),
        normalized_dir: z.string().min(1),
        reports_dir: z.string().min(1),
        public_catalog_dir: z.string().min(1),
        metadata_path: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const sourceTimestampsSchema = z
  .object({
    schedule_of_classes: z.string().nullable(),
    general_catalog: z.string().nullable(),
    instructor_grade_archive: z.string().nullable(),
  })
  .strict();

const gradeArchiveRecordSchema = z
  .object({
    subject: z.string(),
    course: z.string(),
    year: z.string(),
    quarter: z.string(),
    title: z.string().nullable(),
    instructor: z.string().nullable(),
    gpa: z.number().nullable(),
    a: z.number().nullable(),
    b: z.number().nullable(),
    c: z.number().nullable(),
    d: z.number().nullable(),
    f: z.number().nullable(),
    w: z.number().nullable(),
    p: z.number().nullable(),
    np: z.number().nullable(),
    raw: z.record(z.string()),
    matched_via: z.literal('cross_listed').optional(),
  })
  .strict();

const meetingSchema = z
  .object({
    days: z.array(z.string()),
    date: dateSchema
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    start_time: z.string().nullable(),
    end_time: z.string().nullable(),
    building: z.string().nullable(),
    room: z.string().nullable(),
    is_tba: z.boolean(),
    meeting_type: z.string().nullable(),
    raw_days: z.string().nullable(),
    raw_time: z.string().nullable(),
    raw_location: z.string().nullable(),
  })
  .strict();

const sectionSchema = z
  .object({
    section_id: z.string().min(1),
    course_id: z.string().min(1),
    section_code: z.string().nullable(),
    meeting_type: z.string().nullable(),
    instructors: z.array(z.string()),
    meetings: z.array(meetingSchema),
    enrolled: z.number().int().nonnegative().nullable(),
    capacity: z.number().int().nonnegative().nullable(),
    available_seats: z.number().int().nonnegative().nullable().optional(),
    capacity_kind: z
      .enum(['bounded', 'effectively_unbounded'])
      .nullable()
      .optional(),
    reported_capacity: z.number().int().nonnegative().nullable().optional(),
    reported_seats_available: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional(),
    waitlist_count: z.number().int().nonnegative().nullable(),
    availability_verified: z.boolean().optional(),
    availability_timestamp: z.string().nullable().optional(),
    raw: z.record(z.unknown()),
  })
  .strict()
  .superRefine((section, context) => {
    if (section.capacity_kind !== 'effectively_unbounded') return;
    if (section.capacity !== null || section.available_seats !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'effectively unbounded availability cannot publish numeric capacity or available seats',
      });
    }
    const hasReportedSentinel = [
      section.reported_capacity,
      section.reported_seats_available,
    ].some((value) => value === 9999 || value === 99999);
    if (!hasReportedSentinel) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'effectively unbounded availability requires a reported sentinel value',
      });
    }
  });

const courseSchema = z
  .object({
    course_id: z.string().min(1),
    subject: z.string().min(1),
    course_number: z.string().min(1),
    display_course_code: z.string().min(1).nullable().optional(),
    title: z.string().min(1),
    units: z.string().nullable(),
    description: z.string().nullable(),
    prerequisites_text: z.string().nullable(),
    restrictions_text: z.string().nullable(),
    catalog_url: z.string().nullable(),
    archive_avg_gpa: z.number().nullable(),
    archive_record_count: z.number().int().nonnegative(),
    grade_archive_records: z.array(gradeArchiveRecordSchema),
    ge_matches: z.array(z.never()),
    sections: z.array(sectionSchema),
  })
  .strict();

export const catalogSnapshotSchema = z
  .object({
    run_id: z.string().min(1),
    generated_at: z.string().min(1),
    active_planning_term: termCodeSchema,
    term_label: z.string().min(1),
    term_date_range: z
      .object({
        start: dateSchema,
        end: dateSchema,
      })
      .strict()
      .nullable(),
    coverage: z
      .object({
        complete: z.boolean(),
        continuation_needed: z.boolean(),
      })
      .strict()
      .optional(),
    configured_subjects: z.array(z.string().min(1)).min(1),
    source_timestamps: sourceTimestampsSchema,
    courses: z.array(courseSchema),
  })
  .strict();

export type CatalogSnapshotConfig = z.infer<typeof catalogSnapshotConfigSchema>;
export type CatalogSnapshot = z.infer<typeof catalogSnapshotSchema>;

export type CatalogSnapshotMetadata = {
  last_update: string;
  run_id: string;
  generated_at: string;
  active_planning_term: string;
  term_label: string;
  term_date_range: CatalogSnapshot['term_date_range'];
  configured_subjects: string[];
  source_timestamps: CatalogSnapshot['source_timestamps'];
  published_snapshot: string;
};

export type ValidationResult = {
  success: boolean;
  errors: string[];
};

export async function loadCatalogSnapshotConfig(
  configPath: string,
): Promise<CatalogSnapshotConfig> {
  const rawConfig = parse(await readFile(configPath, 'utf-8')) as unknown;
  const parsed = catalogSnapshotConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw new Error(
      `Catalog Snapshot config is invalid:\n${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('\n')}`,
    );
  }
  return parsed.data;
}

const excludedPublicFieldNames = new Set([
  'also_taking',
  'availability',
  'cape',
  'course_evaluations',
  'demand',
  'enrollment_count',
  'enrollment',
  'eval',
  'evals',
  'evaluation',
  'evaluation_narrative_summaries',
  'evaluation_narratives',
  'evaluation_ratings',
  'evaluation_statistic',
  'evaluation_statistics',
  'evaluations',
  'friend',
  'friend_count',
  'friend_counts',
  'friend_ids',
  'friend_net_id',
  'friend_netids',
  'friends',
  'last_enrollment',
  'open_seats',
  'professor_quality',
  'professor_rating',
  'rating',
  'ratings',
  'seat',
  'seat_availability',
  'seat_limit',
  'seats',
  'seats_available',
  'seats_limit',
  'set',
  'waitlist',
  'workload',
  'worksheet_demand',
]);

function normalizeFieldName(key: string): string {
  const normalized = key
    .replace(/(?<=[a-z\d])(?=[A-Z])/gu, '_')
    .replace(/[^\dA-Za-z]+/gu, '_')
    .toLowerCase();
  let start = 0;
  let end = normalized.length;
  while (normalized[start] === '_') start += 1;
  while (end > start && normalized[end - 1] === '_') end -= 1;
  return normalized.slice(start, end);
}

function collectExcludedFieldPaths(value: unknown, fieldPath = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectExcludedFieldPaths(item, `${fieldPath}[${index}]`),
    );
  }
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value).flatMap(([key, child]) => {
    const currentPath = `${fieldPath}.${key}`;
    const normalizedKey = normalizeFieldName(key);
    const ownErrors = excludedPublicFieldNames.has(normalizedKey)
      ? [`excluded field ${currentPath}`]
      : [];
    return ownErrors.concat(collectExcludedFieldPaths(child, currentPath));
  });
}

function validateConfiguredSubjects(
  snapshot: CatalogSnapshot,
  config: CatalogSnapshotConfig,
): string[] {
  const configured = new Set(config.configured_subjects);
  const subjectsInSnapshot = new Set(
    snapshot.courses.map((course) => course.subject),
  );
  const errors: string[] = [];

  for (const subject of subjectsInSnapshot)
    if (!configured.has(subject)) errors.push(`unexpected subject ${subject}`);

  return errors;
}

function validateSectionIds(
  snapshot: CatalogSnapshot,
  config: CatalogSnapshotConfig,
): string[] {
  return snapshot.courses.flatMap((course, courseIndex) =>
    course.sections.flatMap((section, sectionIndex) => {
      if (section.section_id.startsWith(`${config.active_planning_term}:`))
        return [];
      return [
        `courses[${courseIndex}].sections[${sectionIndex}].section_id must start with ${config.active_planning_term}:`,
      ];
    }),
  );
}

function validateAvailabilityTimestamps(snapshot: CatalogSnapshot): string[] {
  const scheduleTimestamp = snapshot.source_timestamps.schedule_of_classes;
  return snapshot.courses.flatMap((course, courseIndex) =>
    course.sections.flatMap((section, sectionIndex) => {
      const hasVerifiedAvailability =
        section.availability_verified === true ||
        section.capacity_kind === 'effectively_unbounded' ||
        section.enrolled !== null ||
        section.capacity !== null ||
        (section.available_seats !== null &&
          section.available_seats !== undefined) ||
        section.waitlist_count !== null;
      if (
        hasVerifiedAvailability &&
        !section.availability_timestamp &&
        !scheduleTimestamp
      ) {
        return [
          `courses[${courseIndex}].sections[${sectionIndex}] verified availability requires a timestamp`,
        ];
      }
      return [];
    }),
  );
}

export function validateCatalogSnapshot(
  value: unknown,
  config: CatalogSnapshotConfig,
): ValidationResult {
  const parsedConfig = catalogSnapshotConfigSchema.safeParse(config);
  if (!parsedConfig.success) {
    return {
      success: false,
      errors: parsedConfig.error.issues.map((issue) => issue.message),
    };
  }

  const parsedSnapshot = catalogSnapshotSchema.safeParse(value);
  if (!parsedSnapshot.success) {
    return {
      success: false,
      errors: parsedSnapshot.error.issues.map((issue) => issue.message),
    };
  }

  const snapshot = parsedSnapshot.data;
  const errors = [
    ...(snapshot.active_planning_term === config.active_planning_term
      ? []
      : ['snapshot active planning term does not match config']),
    ...(snapshot.term_label === config.term_label
      ? []
      : ['snapshot term label does not match config']),
    ...validateConfiguredSubjects(snapshot, config),
    ...validateSectionIds(snapshot, config),
    ...validateAvailabilityTimestamps(snapshot),
    ...collectExcludedFieldPaths(snapshot),
  ];

  return {
    success: errors.length === 0,
    errors,
  };
}

export function buildTracerCatalogSnapshot(
  config: CatalogSnapshotConfig,
  options: {
    runId?: string;
    generatedAt?: string;
    generalCatalogCourses?: GeneralCatalogCourse[];
  } = {},
): CatalogSnapshot {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runId = options.runId ?? `tracer-${generatedAt}`;
  const generalCatalogCourseBySubject = new Map<string, GeneralCatalogCourse>();
  for (const course of options.generalCatalogCourses ?? []) {
    if (generalCatalogCourseBySubject.has(course.subject)) continue;
    generalCatalogCourseBySubject.set(course.subject, course);
  }

  return {
    run_id: runId,
    generated_at: generatedAt,
    active_planning_term: config.active_planning_term,
    term_label: config.term_label,
    term_date_range: config.term_date_range,
    configured_subjects: config.configured_subjects,
    source_timestamps: {
      schedule_of_classes: null,
      general_catalog: null,
      instructor_grade_archive: null,
    },
    courses: config.configured_subjects.map((subject) => {
      const generalCatalogCourse = generalCatalogCourseBySubject.get(subject);
      const courseNumber = generalCatalogCourse?.course_number ?? '1';
      const courseId =
        generalCatalogCourse?.course_id ?? `${subject}:${courseNumber}`;
      const sectionSuffix = generalCatalogCourse ? courseNumber : '001';
      return {
        course_id: courseId,
        subject,
        course_number: courseNumber,
        title: generalCatalogCourse?.title ?? `${subject} Tracer Course`,
        units: generalCatalogCourse?.units ?? null,
        description:
          generalCatalogCourse?.description ?? `Tracer course for ${subject}.`,
        prerequisites_text: generalCatalogCourse?.prerequisites_text ?? null,
        restrictions_text: generalCatalogCourse?.restrictions_text ?? null,
        catalog_url: generalCatalogCourse?.catalog_url ?? null,
        archive_avg_gpa: null,
        archive_record_count: 0,
        grade_archive_records: [],
        ge_matches: [],
        sections: [
          {
            section_id: `${config.active_planning_term}:${subject}-TRACER-${sectionSuffix}`,
            course_id: courseId,
            section_code: 'A00',
            meeting_type: 'Lecture',
            instructors: [],
            meetings: [
              {
                date: null,
                days: [],
                start_time: null,
                end_time: null,
                building: null,
                room: null,
                is_tba: true,
                meeting_type: 'Lecture',
                raw_days: null,
                raw_time: 'TBA',
                raw_location: null,
              },
            ],
            enrolled: null,
            capacity: null,
            waitlist_count: null,
            availability_verified: false,
            availability_timestamp: null,
            raw: {
              source: 'tracer',
            },
          },
        ],
      };
    }),
  };
}

export function gradeArchiveCourseId(record: GradeArchiveRecord): string {
  return `${record.subject.trim().toUpperCase()}:${record.course
    .trim()
    .toUpperCase()
    .replace(/\s+/gu, '')}`;
}

function meanGpa(records: GradeArchiveRecord[]): number | null {
  const gpas = records
    .map((record) => record.gpa)
    .filter((gpa): gpa is number => gpa !== null);
  if (!gpas.length) return null;
  return gpas.reduce((sum, gpa) => sum + gpa, 0) / gpas.length;
}

const archiveQuarterRank: { [quarter: string]: number } = {
  WI: 1,
  WN: 1,
  SP: 2,
  S1: 3,
  SS1: 3,
  SU1: 3,
  S2: 4,
  SS2: 4,
  SU2: 4,
  S3: 5,
  SS: 5,
  SS3: 5,
  SU: 5,
  SU3: 5,
  FA: 6,
};

function archiveYearValue(year: string): number | null {
  const parsed = Number.parseInt(year.trim(), 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed < 100 ? 2000 + parsed : parsed;
}

function compareArchiveTerm(a: GradeArchiveRecord, b: GradeArchiveRecord) {
  const yearA = archiveYearValue(a.year);
  const yearB = archiveYearValue(b.year);
  if (yearA !== null && yearB !== null && yearA !== yearB) return yearA - yearB;
  if (yearA !== null && yearB === null) return 1;
  if (yearA === null && yearB !== null) return -1;
  if (yearA === null && yearB === null) {
    const yearComparison = a.year.localeCompare(b.year, 'en-US', {
      numeric: true,
      sensitivity: 'base',
    });
    if (yearComparison !== 0) return yearComparison;
  }

  const quarterA = a.quarter.trim().toUpperCase();
  const quarterB = b.quarter.trim().toUpperCase();
  const rankA = archiveQuarterRank[quarterA] ?? 0;
  const rankB = archiveQuarterRank[quarterB] ?? 0;
  if (rankA !== rankB) return rankA - rankB;
  return quarterA.localeCompare(quarterB, 'en-US', {
    numeric: true,
    sensitivity: 'base',
  });
}

function mostRecentTermRecords(records: GradeArchiveRecord[]) {
  let [mostRecent] = records;
  if (!mostRecent) return [];
  for (const record of records)
    if (compareArchiveTerm(record, mostRecent) > 0) mostRecent = record;
  return records.filter(
    (record) => compareArchiveTerm(record, mostRecent) === 0,
  );
}

function meanMostRecentTermGpa(records: GradeArchiveRecord[]): number | null {
  return meanGpa(mostRecentTermRecords(records));
}

type SnapshotCourse = CatalogSnapshot['courses'][number];

function normalizedInstructorName(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

function instructionalMeetingSignature(
  meeting: SnapshotCourse['sections'][number]['meetings'][number],
): string | null {
  if (
    meeting.is_tba ||
    !meeting.start_time ||
    !meeting.end_time ||
    meeting.meeting_type?.trim().toLowerCase() === 'final'
  )
    return null;
  return [
    [...meeting.days].sort().join(','),
    meeting.date ?? '',
    meeting.start_time,
    meeting.end_time,
    meeting.building ?? '',
    meeting.room ?? '',
  ].join('|');
}

function coursesShareScheduledOffering(
  target: SnapshotCourse,
  source: SnapshotCourse,
): boolean {
  return target.sections.some((targetSection) => {
    const targetInstructors = new Set(
      targetSection.instructors.map(normalizedInstructorName),
    );
    const targetMeetings = new Set(
      targetSection.meetings
        .map(instructionalMeetingSignature)
        .filter((signature): signature is string => signature !== null),
    );
    return source.sections.some((sourceSection) => {
      const hasSharedInstructor = sourceSection.instructors.some((instructor) =>
        targetInstructors.has(normalizedInstructorName(instructor)),
      );
      const hasSharedMeeting = sourceSection.meetings.some((meeting) => {
        const signature = instructionalMeetingSignature(meeting);
        return signature !== null && targetMeetings.has(signature);
      });
      return hasSharedInstructor && hasSharedMeeting;
    });
  });
}

function crossListedGradeArchiveRecords(
  course: SnapshotCourse,
  coursesById: Map<string, SnapshotCourse>,
  recordsByCourseId: Map<string, GradeArchiveRecord[]>,
): GradeArchiveRecord[] {
  const sources = crossListedCourseIds(course.description)
    .map((courseId) => ({
      course: coursesById.get(courseId),
      records: recordsByCourseId.get(courseId) ?? [],
    }))
    .filter(
      (
        source,
      ): source is { course: SnapshotCourse; records: GradeArchiveRecord[] } =>
        source.course !== undefined &&
        source.records.length > 0 &&
        coursesShareScheduledOffering(course, source.course),
    );
  if (sources.length !== 1) return [];
  return sources[0]!.records.map((record) => ({
    ...record,
    matched_via: 'cross_listed',
  }));
}

export function attachGradeArchiveRecords(
  snapshot: CatalogSnapshot,
  records: GradeArchiveRecord[],
): CatalogSnapshot {
  const coursesById = new Map(
    snapshot.courses.map((course) => [course.course_id, course]),
  );
  const recordsByCourseId = new Map<string, GradeArchiveRecord[]>();
  for (const record of records) {
    const courseId = gradeArchiveCourseId(record);
    const courseRecords = recordsByCourseId.get(courseId) ?? [];
    courseRecords.push(record);
    recordsByCourseId.set(courseId, courseRecords);
  }
  return {
    ...snapshot,
    courses: snapshot.courses.map((course) => {
      const exactRecords = recordsByCourseId.get(course.course_id) ?? [];
      const gradeArchiveRecords = exactRecords.length
        ? exactRecords
        : crossListedGradeArchiveRecords(
            course,
            coursesById,
            recordsByCourseId,
          );
      return {
        ...course,
        archive_avg_gpa: meanMostRecentTermGpa(gradeArchiveRecords),
        archive_record_count: gradeArchiveRecords.length,
        grade_archive_records: gradeArchiveRecords,
      };
    }),
  };
}

export function attachGeneralCatalogMetadata(
  snapshot: CatalogSnapshot,
  catalogCourses: GeneralCatalogCourse[],
): CatalogSnapshot {
  const coursesByCourseId = new Map(
    catalogCourses.map((course) => [course.course_id, course]),
  );
  return {
    ...snapshot,
    courses: snapshot.courses.map((course) => {
      const catalogCourse = coursesByCourseId.get(course.course_id);
      if (!catalogCourse) return course;
      return {
        ...course,
        title: catalogCourse.title,
        units: catalogCourse.units,
        description: catalogCourse.description,
        prerequisites_text: catalogCourse.prerequisites_text,
        restrictions_text: catalogCourse.restrictions_text,
        catalog_url: catalogCourse.catalog_url,
      };
    }),
  };
}

export function buildCatalogSnapshotMetadata(
  snapshot: CatalogSnapshot,
): CatalogSnapshotMetadata {
  return {
    last_update: snapshot.generated_at,
    run_id: snapshot.run_id,
    generated_at: snapshot.generated_at,
    active_planning_term: snapshot.active_planning_term,
    term_label: snapshot.term_label,
    term_date_range: snapshot.term_date_range,
    configured_subjects: snapshot.configured_subjects,
    source_timestamps: snapshot.source_timestamps,
    published_snapshot: `catalogs/public/${snapshot.active_planning_term}.json`,
  };
}

export async function publishCatalogSnapshot(
  snapshot: CatalogSnapshot,
  config: CatalogSnapshotConfig,
  options: { writeMetadata?: boolean; storage?: SnapshotStorage } = {},
): Promise<{ snapshotPath: string; metadataPath: string | null }> {
  const validation = validateCatalogSnapshot(snapshot, config);
  if (!validation.success) {
    throw new Error(
      `Catalog Snapshot validation failed:\n${validation.errors.join('\n')}`,
    );
  }

  // The multi-term runner publishes one snapshot per term but writes the
  // Supported Term registry once, so it opts out of the single-term metadata.
  const writeMetadata = options.writeMetadata ?? true;
  const snapshotPath = pathModule.join(
    config.paths.public_catalog_dir,
    `${snapshot.active_planning_term}.json`,
  );
  const metadataPath = config.paths.metadata_path;
  const storage = options.storage ?? createFileSnapshotStorage();

  await storage.writeJson(snapshotPath, snapshot);
  if (writeMetadata) {
    await storage.writeJson(
      metadataPath,
      buildCatalogSnapshotMetadata(snapshot),
    );
  }

  return { snapshotPath, metadataPath: writeMetadata ? metadataPath : null };
}
