import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  comparableDomainValue,
  type DomainProjection,
  type DomainRecord,
} from './courseDataParityComparator.js';

function mapRecords(
  records: DomainRecord[],
  identity: (record: DomainRecord, index: number) => string,
) {
  return new Map(
    records.map((record, index) => [identity(record, index), record]),
  );
}

function multisetRecords(records: DomainRecord[], ownerField: string) {
  const occurrences = new Map<string, number>();
  return mapRecords(records, (record) => {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(comparableDomainValue(record)))
      .digest('hex')
      .slice(0, 16);
    const baseIdentity = `${String(record[ownerField])}:${fingerprint}`;
    const occurrence = occurrences.get(baseIdentity) ?? 0;
    occurrences.set(baseIdentity, occurrence + 1);
    return `${baseIdentity}:${occurrence}`;
  });
}

function timestamp(value: unknown) {
  return typeof value === 'string' ? new Date(value).toISOString() : value;
}

function termState(snapshot: DomainRecord, lifecycle: 'published' | 'frozen') {
  if (lifecycle === 'frozen') return 'historical';
  const range = snapshot.term_date_range as
    | { start: string; end: string }
    | null
    | undefined;
  if (!range) return 'undated';
  const generatedDate = String(snapshot.generated_at).slice(0, 10);
  if (generatedDate < range.start) return 'upcoming';
  if (generatedDate > range.end) return 'historical';
  return 'active';
}

export async function projectPublishedSnapshot(
  snapshotPath: string,
  manifestPath: string,
  lifecycle: 'published' | 'frozen' = 'published',
): Promise<DomainProjection> {
  const [snapshotContents, manifestContents] = await Promise.all([
    readFile(snapshotPath, 'utf8'),
    readFile(manifestPath, 'utf8'),
  ]);
  const snapshot = JSON.parse(snapshotContents) as DomainRecord;
  const manifest = JSON.parse(manifestContents) as DomainRecord;
  const courses = snapshot.courses as DomainRecord[];
  const sections = courses.flatMap(
    (course) => course.sections as DomainRecord[],
  );
  const meetings = sections.flatMap((section) =>
    (section.meetings as DomainRecord[]).map((meeting) => ({
      termCode: snapshot.active_planning_term,
      sectionId: section.section_id,
      days: meeting.days,
      date: meeting.date,
      startTime: meeting.start_time,
      endTime: meeting.end_time,
      building: meeting.building,
      room: meeting.room,
      isTba: meeting.is_tba,
      meetingType: meeting.meeting_type,
      rawDays: meeting.raw_days,
      rawTime: meeting.raw_time,
      rawLocation: meeting.raw_location,
    })),
  );
  const snapshotFingerprint = createHash('sha256')
    .update(snapshotContents)
    .digest('hex');
  const manifestFingerprint = createHash('sha256')
    .update(manifestContents)
    .digest('hex');
  const summary = manifest.summary as DomainRecord;
  const sourceTimestamps = snapshot.source_timestamps as DomainRecord;

  return {
    supportedTerms: mapRecords(
      [
        {
          termCode: snapshot.active_planning_term,
          termLabel: snapshot.term_label,
          dateStart:
            (snapshot.term_date_range as DomainRecord | null)?.start ?? null,
          dateEnd:
            (snapshot.term_date_range as DomainRecord | null)?.end ?? null,
          snapshotGeneratedAt: timestamp(snapshot.generated_at),
          artifactFingerprint: snapshotFingerprint,
          snapshotLifecycle: lifecycle,
        },
      ],
      (record) => String(record.termCode),
    ),
    courses: mapRecords(
      courses.map((course) => ({
        termCode: snapshot.active_planning_term,
        courseId: course.course_id,
        subject: course.subject,
        courseNumber: course.course_number,
        title: course.title,
        units: course.units,
        description: course.description,
        prerequisitesText: course.prerequisites_text,
        restrictionsText: course.restrictions_text,
        catalogUrl: course.catalog_url,
      })),
      (record) => String(record.courseId),
    ),
    sections: mapRecords(
      sections.map((section) => ({
        termCode: snapshot.active_planning_term,
        sectionId: section.section_id,
        courseId: section.course_id,
        sectionCode: section.section_code,
        meetingType: section.meeting_type,
      })),
      (record) => String(record.sectionId),
    ),
    meetings: multisetRecords(meetings, 'sectionId'),
    sectionInstructors: mapRecords(
      sections.flatMap((section) =>
        (section.instructors as string[]).map((instructorName) => ({
          termCode: snapshot.active_planning_term,
          sectionId: section.section_id,
          instructorName,
        })),
      ),
      (record) =>
        `${String(record.sectionId)}:${String(record.instructorName)}`,
    ),
    gradeArchiveRecords: multisetRecords(
      courses.flatMap((course) =>
        (course.grade_archive_records as DomainRecord[]).map((record) => ({
          termCode: snapshot.active_planning_term,
          courseId: course.course_id,
          subject: record.subject,
          courseNumber: record.course,
          year: record.year,
          quarter: record.quarter,
          title: record.title,
          instructor: record.instructor,
          gpa: record.gpa,
          aPercent: record.a,
          bPercent: record.b,
          cPercent: record.c,
          dPercent: record.d,
          fPercent: record.f,
          wPercent: record.w,
          pPercent: record.p,
          npPercent: record.np,
          rawRecord: record.raw,
          matchedVia: record.matched_via ?? null,
        })),
      ),
      'courseId',
    ),
    snapshotAvailability: mapRecords(
      sections.map((section) => ({
        termCode: snapshot.active_planning_term,
        sectionId: section.section_id,
        enrolled: section.enrolled,
        capacity: section.capacity,
        waitlistCount: section.waitlist_count,
        observedAt: timestamp(snapshot.generated_at),
        termState: termState(snapshot, lifecycle),
      })),
      (record) => String(record.sectionId),
    ),
    importRuns: mapRecords(
      [
        {
          artifactFingerprint: snapshotFingerprint,
          snapshotRunId: snapshot.run_id,
          generatedAt: timestamp(snapshot.generated_at),
          termCode: snapshot.active_planning_term,
          snapshotLifecycle: lifecycle,
          scheduleSourceTimestamp: sourceTimestamps.schedule_of_classes,
          catalogSourceTimestamp: sourceTimestamps.general_catalog,
          gradeSourceTimestamp: sourceTimestamps.instructor_grade_archive,
          manifestFingerprint,
          manifestOk: summary.ok,
          manifestEmpty: summary.empty,
          manifestFailed: summary.failed,
          manifestPartial: summary.partial,
        },
      ],
      (record) => String(record.artifactFingerprint),
    ),
    manifestCells: mapRecords(
      (manifest.cells as DomainRecord[]).map((cell) => ({
        artifactFingerprint: snapshotFingerprint,
        termCode: snapshot.active_planning_term,
        subject: cell.subject,
        source: cell.source,
        status: cell.status,
        reason: cell.reason,
        attempts: cell.attempts,
        rowCounts: cell.row_counts,
        rawArtifacts: cell.raw_artifacts,
        normalizedArtifact: cell.normalized_artifact,
      })),
      (record) => `${String(record.subject)}:${String(record.source)}`,
    ),
  };
}

type PublicQuery = (
  query: string,
  variables: { [name: string]: unknown },
) => Promise<{ data?: { [root: string]: unknown }; errors?: unknown[] }>;

const publicRoots = {
  supportedTerms: {
    fields:
      'termCode termLabel dateStart dateEnd snapshotGeneratedAt artifactFingerprint snapshotLifecycle',
    orderBy: '{termCode: asc}',
    category: 'supportedTerms',
    identity: (record: DomainRecord) => String(record.termCode),
  },
  courses: {
    fields:
      'termCode courseId subject courseNumber title units description prerequisitesText restrictionsText catalogUrl',
    orderBy: '{courseId: asc}',
    category: 'courses',
    identity: (record: DomainRecord) => String(record.courseId),
  },
  sections: {
    fields: 'termCode sectionId courseId sectionCode meetingType',
    orderBy: '{sectionId: asc}',
    category: 'sections',
    identity: (record: DomainRecord) => String(record.sectionId),
  },
  meetings: {
    fields:
      'termCode sectionId meetingIndex days date startTime endTime building room isTba meetingType rawDays rawTime rawLocation',
    orderBy: '[{sectionId: asc}, {meetingIndex: asc}]',
    category: 'meetings',
    identity: null,
  },
  sectionInstructors: {
    fields: 'termCode sectionId instructorName',
    orderBy: '[{sectionId: asc}, {instructorName: asc}]',
    category: 'sectionInstructors',
    identity: (record: DomainRecord) =>
      `${String(record.sectionId)}:${String(record.instructorName)}`,
  },
  gradeArchiveRecords: {
    fields:
      'termCode courseId recordIndex subject courseNumber year quarter title instructor gpa aPercent bPercent cPercent dPercent fPercent wPercent pPercent npPercent rawRecord matchedVia',
    orderBy: '[{courseId: asc}, {recordIndex: asc}]',
    category: 'gradeArchiveRecords',
    identity: null,
  },
  snapshotAvailability: {
    fields:
      'termCode sectionId enrolled capacity waitlistCount observedAt termState',
    orderBy: '{sectionId: asc}',
    category: 'snapshotAvailability',
    identity: (record: DomainRecord) => String(record.sectionId),
  },
  courseDataImportRuns: {
    fields:
      'artifactFingerprint snapshotRunId generatedAt termCode snapshotLifecycle scheduleSourceTimestamp catalogSourceTimestamp gradeSourceTimestamp manifestFingerprint manifestOk manifestEmpty manifestFailed manifestPartial',
    orderBy: '[{generatedAt: asc}, {artifactFingerprint: asc}]',
    category: 'importRuns',
    identity: (record: DomainRecord) => String(record.artifactFingerprint),
  },
  importManifestCells: {
    fields:
      'artifactFingerprint termCode subject source status reason attempts rowCounts rawArtifacts normalizedArtifact',
    orderBy: '[{subject: asc}, {source: asc}]',
    category: 'manifestCells',
    identity: (record: DomainRecord) =>
      `${String(record.subject)}:${String(record.source)}`,
  },
} as const;

export async function queryPublicCourseDataProjection(
  queryPublic: PublicQuery,
  term: string,
): Promise<DomainProjection> {
  const result: DomainProjection = {};
  for (const [root, descriptor] of Object.entries(publicRoots)) {
    const { category, fields, identity, orderBy } = descriptor;
    const records: DomainRecord[] = [];
    for (let offset = 0; ; offset += 100) {
      const response = await queryPublic(
        `query ParityPage($term: String!, $limit: Int!, $offset: Int!) {
          ${root}(
            where: {termCode: {_eq: $term}},
            order_by: ${orderBy},
            limit: $limit,
            offset: $offset
          ) {
            ${fields}
          }
        }`,
        { term, limit: 100, offset },
      );
      if (response.errors)
        throw new Error(`Public GraphQL parity query failed for ${root}`);
      const page = response.data?.[root] as DomainRecord[] | undefined;
      if (!page) throw new Error(`Public GraphQL omitted parity root ${root}`);
      records.push(...page);
      if (page.length < 100) break;
    }
    for (const record of records) {
      delete record.meetingIndex;
      delete record.recordIndex;
      for (const field of [
        'snapshotGeneratedAt',
        'generatedAt',
        'observedAt',
      ]) {
        if (record[field] !== undefined)
          record[field] = timestamp(record[field]);
      }
      for (const field of [
        'gpa',
        'aPercent',
        'bPercent',
        'cPercent',
        'dPercent',
        'fPercent',
        'wPercent',
        'pPercent',
        'npPercent',
      ]) {
        if (typeof record[field] === 'string')
          record[field] = Number(record[field]);
      }
    }
    result[category] = identity
      ? mapRecords(records, identity)
      : multisetRecords(
          records,
          category === 'meetings' ? 'sectionId' : 'courseId',
        );
  }
  return result;
}
