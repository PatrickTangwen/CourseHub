import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import postgres from 'postgres';
import { z } from 'zod';

import { catalogSnapshotSchema } from '../catalog-snapshot/catalogSnapshot.js';

export type SnapshotImportSummary = {
  term: string;
  lifecycle: SnapshotLifecycle;
  dryRun: boolean;
  courses: ChangeCounts & { rejected: number };
  sections: ChangeCounts;
  meetings: ChangeCounts;
  instructors: ChangeCounts;
  instructorLinks: ChangeCounts;
  gradeRecords: ChangeCounts;
  availabilityObservations: ChangeCounts;
  manifestCells: ChangeCounts;
  importRun: 'created' | 'unchanged';
};

type ChangeCounts = {
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  identities: {
    created: string[];
    updated: string[];
    unchanged: string[];
    removed: string[];
  };
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function changeCounts(
  incoming: Map<string, unknown>,
  existing: Map<string, unknown>,
): ChangeCounts {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const identities = {
    created: [] as string[],
    updated: [] as string[],
    unchanged: [] as string[],
    removed: [] as string[],
  };
  for (const [identity, value] of incoming) {
    if (!existing.has(identity)) {
      created += 1;
      identities.created.push(identity);
    } else if (canonicalJson(existing.get(identity)) === canonicalJson(value)) {
      unchanged += 1;
      identities.unchanged.push(identity);
    } else {
      updated += 1;
      identities.updated.push(identity);
    }
  }
  identities.removed = [...existing.keys()].filter(
    (identity) => !incoming.has(identity),
  );
  for (const group of Object.values(identities)) group.splice(20);
  return {
    created,
    updated,
    unchanged,
    removed: [...existing.keys()].filter((identity) => !incoming.has(identity))
      .length,
    identities,
  };
}

function multisetMap<T>(
  rows: T[],
  context: (row: T) => string,
  value: (row: T) => unknown,
  identityValue: (row: T) => unknown = value,
) {
  const occurrences = new Map<string, number>();
  return new Map(
    rows.map((row) => {
      const rowValue = value(row);
      const digest = createHash('sha256')
        .update(canonicalJson(identityValue(row)))
        .digest('hex')
        .slice(0, 16);
      const baseIdentity = `${context(row)}:${digest}`;
      const occurrence = occurrences.get(baseIdentity) ?? 0;
      occurrences.set(baseIdentity, occurrence + 1);
      return [`${baseIdentity}:${occurrence}`, rowValue];
    }),
  );
}

export type SnapshotImportOptions = {
  dryRun?: boolean;
  lifecycle?: SnapshotLifecycle;
  failAfterTermRemoval?: boolean;
  afterTermRemoval?: () => Promise<void>;
};

type SnapshotLifecycle = 'published' | 'frozen';

class LifecycleError extends Error {
  readonly reason: 'invalid_lifecycle' | 'frozen_term_immutable';

  constructor(
    message: string,
    reason: 'invalid_lifecycle' | 'frozen_term_immutable',
  ) {
    super(message);
    this.reason = reason;
  }
}

class ImportRejection extends Error {
  readonly group: 'courses' | 'sections' | 'manifestCells';
  readonly identities: string[];
  readonly reason: string;

  constructor(
    message: string,
    group: 'courses' | 'sections' | 'manifestCells',
    identities: string[],
    reason: string,
  ) {
    super(message);
    this.group = group;
    this.identities = identities;
    this.reason = reason;
  }
}

const manifestSchema = z
  .object({
    run_id: z.string().min(1),
    generated_at: z.string().min(1),
    active_planning_term: z.string().min(1),
    term_label: z.string().min(1),
    configured_subjects: z.array(z.string()),
    systemic_parser_failure_threshold: z.number(),
    cells: z.array(
      z
        .object({
          term: z.string(),
          subject: z.string(),
          source: z.enum([
            'schedule_of_classes',
            'general_catalog',
            'instructor_grade_archive',
          ]),
          status: z.enum(['ok', 'empty', 'failed', 'partial']),
          reason: z.string().nullable(),
          attempts: z.number().int().nonnegative(),
          row_counts: z.record(z.number()),
          raw_artifacts: z.array(z.string()),
          normalized_artifact: z.string().nullable(),
        })
        .strict(),
    ),
    summary: z
      .object({
        ok: z.number().int().nonnegative(),
        empty: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        partial: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

function parseSnapshotJson(contents: string): unknown {
  try {
    return JSON.parse(contents) as unknown;
  } catch {
    throw new Error('Published Snapshot is invalid: malformed JSON');
  }
}

export async function importSnapshot(
  snapshotPath: string,
  databaseUrl: string,
  manifestPath: string,
  options: SnapshotImportOptions = {},
): Promise<SnapshotImportSummary> {
  const lifecycle = options.lifecycle ?? 'published';
  const contents = await readFile(snapshotPath, 'utf8');
  const parsed = catalogSnapshotSchema.safeParse(parseSnapshotJson(contents));
  if (!parsed.success) {
    throw new Error(
      `Published Snapshot is invalid: ${parsed.error.issues.length} validation issue(s)`,
    );
  }

  const snapshot = parsed.data;
  const manifestContents = await readFile(manifestPath, 'utf8');
  const manifestResult = manifestSchema.safeParse(
    parseSnapshotJson(manifestContents),
  );
  if (!manifestResult.success) {
    throw new ImportRejection(
      'Import Manifest schema is invalid',
      'manifestCells',
      [],
      'invalid_manifest',
    );
  }
  const manifest = manifestResult.data;
  if (
    manifest.run_id !== snapshot.run_id ||
    manifest.generated_at !== snapshot.generated_at ||
    manifest.active_planning_term !== snapshot.active_planning_term
  )
    throw new Error('Import Manifest does not match Published Snapshot');
  if (
    JSON.stringify(manifest.configured_subjects) !==
    JSON.stringify(snapshot.configured_subjects)
  )
    throw new Error('Import Manifest subjects do not match Published Snapshot');
  const manifestStatusCounts = {
    ok: manifest.cells.filter(({ status }) => status === 'ok').length,
    empty: manifest.cells.filter(({ status }) => status === 'empty').length,
    failed: manifest.cells.filter(({ status }) => status === 'failed').length,
    partial: manifest.cells.filter(({ status }) => status === 'partial').length,
  };
  if (JSON.stringify(manifest.summary) !== JSON.stringify(manifestStatusCounts))
    throw new Error('Import Manifest summary does not match its cells');
  const manifestCellKeys = new Set<string>();
  const expectedManifestCellKeys = new Set(
    manifest.configured_subjects.flatMap((subject) =>
      [
        'schedule_of_classes',
        'general_catalog',
        'instructor_grade_archive',
      ].map((source) => `${subject}:${source}`),
    ),
  );
  for (const cell of manifest.cells) {
    if (cell.term !== manifest.active_planning_term)
      throw new Error('Import Manifest cell belongs to a different term');
    const key = `${cell.subject}:${cell.source}`;
    if (!expectedManifestCellKeys.has(key)) {
      throw new ImportRejection(
        'Import Manifest cell is outside configured coverage',
        'manifestCells',
        [key],
        'invalid_manifest_coverage',
      );
    }
    if (manifestCellKeys.has(key)) {
      throw new ImportRejection(
        'Import Manifest contains duplicate cells',
        'manifestCells',
        [key],
        'duplicate_manifest_identity',
      );
    }
    manifestCellKeys.add(key);
  }
  if (manifestCellKeys.size !== expectedManifestCellKeys.size) {
    throw new ImportRejection(
      'Import Manifest is missing configured cells',
      'manifestCells',
      [...expectedManifestCellKeys].filter((key) => !manifestCellKeys.has(key)),
      'missing_manifest_identity',
    );
  }
  const failedCoreCells = manifest.cells.filter(
    ({ source, status }) =>
      source === 'schedule_of_classes' &&
      (status === 'failed' || status === 'partial'),
  );
  if (failedCoreCells.length > 0) {
    throw new ImportRejection(
      'Import Manifest has failed or partial core source cells',
      'manifestCells',
      failedCoreCells.map(({ source, subject }) => `${subject}:${source}`),
      'invalid_core_source',
    );
  }

  const sections = snapshot.courses.flatMap((course) => course.sections);
  const courseIds = new Set(snapshot.courses.map((course) => course.course_id));
  if (courseIds.size !== snapshot.courses.length) {
    const seen = new Set<string>();
    const duplicates = snapshot.courses
      .map((course) => course.course_id)
      .filter((courseId) => (seen.has(courseId) ? true : !seen.add(courseId)));
    throw new ImportRejection(
      'Published Snapshot contains duplicate Course IDs',
      'courses',
      duplicates,
      'duplicate_course_identity',
    );
  }
  const sectionIds = new Set<string>();
  for (const course of snapshot.courses) {
    for (const section of course.sections) {
      if (section.course_id !== course.course_id) {
        throw new ImportRejection(
          'Published Snapshot has an invalid Section relationship',
          'sections',
          [section.section_id],
          'invalid_relationship',
        );
      }
      if (sectionIds.has(section.section_id)) {
        throw new ImportRejection(
          'Published Snapshot contains duplicate Section IDs',
          'sections',
          [section.section_id],
          'duplicate_section_identity',
        );
      }
      sectionIds.add(section.section_id);
    }
  }
  const meetings = sections.flatMap((section) =>
    section.meetings.map((meeting, meetingIndex) => ({
      ...meeting,
      sectionId: section.section_id,
      meetingIndex,
    })),
  );
  const instructorNames = [
    ...new Set(sections.flatMap((section) => section.instructors)),
  ];
  const instructorLinks = sections.flatMap((section) =>
    section.instructors.map((instructorName) => ({
      sectionId: section.section_id,
      instructorName,
    })),
  );
  const gradeRecords = snapshot.courses.flatMap((course) =>
    course.grade_archive_records.map((record, recordIndex) => ({
      courseId: course.course_id,
      recordIndex,
      record,
    })),
  );
  const availabilityObservations = sections.map((section) => ({
    sectionId: section.section_id,
    enrolled: section.enrolled,
    capacity: section.capacity,
    waitlistCount: section.waitlist_count,
  }));
  const fingerprint = createHash('sha256').update(contents).digest('hex');
  const manifestFingerprint = createHash('sha256')
    .update(manifestContents)
    .digest('hex');
  const generatedDate = new Date(snapshot.generated_at)
    .toISOString()
    .slice(0, 10);
  const termState =
    lifecycle === 'frozen'
      ? 'historical'
      : !snapshot.term_date_range
        ? 'undated'
        : generatedDate < snapshot.term_date_range.start
          ? 'upcoming'
          : generatedDate > snapshot.term_date_range.end
            ? 'historical'
            : 'active';
  const mapRows = <T,>(rows: T[], identity: (row: T) => string) =>
    new Map(rows.map((row) => [identity(row), row]));
  const incoming = {
    courses: mapRows(
      snapshot.courses.map((course) => ({
        course_id: course.course_id,
        subject: course.subject,
        course_number: course.course_number,
        title: course.title,
        units: course.units,
        description: course.description,
        prerequisites_text: course.prerequisites_text,
        restrictions_text: course.restrictions_text,
        catalog_url: course.catalog_url,
      })),
      (row) => row.course_id,
    ),
    sections: mapRows(
      sections.map((section) => ({
        section_id: section.section_id,
        course_id: section.course_id,
        section_code: section.section_code,
        meeting_type: section.meeting_type,
      })),
      (row) => row.section_id,
    ),
    meetings: multisetMap(
      meetings,
      (meeting) => meeting.sectionId,
      (meeting) => ({
        days: meeting.days,
        meeting_date: meeting.date,
        start_time: meeting.start_time,
        end_time: meeting.end_time,
        building: meeting.building,
        room: meeting.room,
        is_tba: meeting.is_tba,
        meeting_type: meeting.meeting_type,
        raw_days: meeting.raw_days,
        raw_time: meeting.raw_time,
        raw_location: meeting.raw_location,
      }),
    ),
    instructors: mapRows(
      instructorNames.map((instructorName) => ({
        instructor_name: instructorName,
      })),
      (row) => row.instructor_name,
    ),
    instructorLinks: mapRows(
      instructorLinks.map((link) => ({
        section_id: link.sectionId,
        instructor_name: link.instructorName,
      })),
      (row) => `${row.section_id}:${row.instructor_name}`,
    ),
    gradeRecords: multisetMap(
      gradeRecords,
      ({ courseId }) => courseId,
      ({ record }) => ({
        raw_record: record.raw,
        matched_via: record.matched_via ?? null,
      }),
      ({ record }) => ({ raw_record: record.raw }),
    ),
    availability: mapRows(
      availabilityObservations.map((observation) => ({
        section_id: observation.sectionId,
        enrolled: observation.enrolled,
        capacity: observation.capacity,
        waitlist_count: observation.waitlistCount,
      })),
      (row) => row.section_id,
    ),
    manifestCells: mapRows(
      manifest.cells.map((cell) => ({
        subject: cell.subject,
        source: cell.source,
        status: cell.status,
        reason: cell.reason,
        attempts: cell.attempts,
        row_counts: cell.row_counts,
        raw_artifacts: cell.raw_artifacts,
        normalized_artifact: cell.normalized_artifact,
      })),
      (row) => `${row.subject}:${row.source}`,
    ),
  };
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    return await sql.begin(async (transaction) => {
      const tx = transaction as unknown as typeof sql;
      await tx`select pg_advisory_xact_lock(hashtext('course-data-import'), hashtext(${snapshot.active_planning_term}))`;
      const [existingRun] = await tx<{ exists: boolean }[]>`
        select exists(
          select 1 from import_runs where artifact_fingerprint = ${fingerprint}
        ) as exists
      `;
      const [existingTerm] = await tx<
        {
          artifactFingerprint: string;
          generatedAt: string;
          lifecycle: SnapshotLifecycle;
        }[]
      >`
        select artifact_fingerprint as "artifactFingerprint",
          snapshot_generated_at::text as "generatedAt",
          snapshot_lifecycle as lifecycle
        from supported_terms
        where term_code = ${snapshot.active_planning_term}
      `;
      if (
        existingTerm?.lifecycle === 'frozen' &&
        (existingTerm.artifactFingerprint !== fingerprint ||
          lifecycle !== 'frozen')
      ) {
        throw new LifecycleError(
          'Frozen Snapshot projection is immutable',
          'frozen_term_immutable',
        );
      }
      if (existingTerm && existingTerm.artifactFingerprint !== fingerprint) {
        if (
          new Date(snapshot.generated_at) <= new Date(existingTerm.generatedAt)
        ) {
          throw new Error(
            'Replacement Snapshot is not newer than the accepted artifact',
          );
        }
      }
      type StoredRow = { identity: string; value: unknown };
      const [
        storedCourses,
        storedSections,
        storedMeetings,
        storedInstructors,
        storedInstructorLinks,
        storedGradeRecords,
        storedAvailability,
        storedManifestCells,
      ] = await Promise.all([
        tx<StoredRow[]>`
          select course_id as identity, to_jsonb(c) - 'term_code' as value
          from courses c where term_code = ${snapshot.active_planning_term}
        `,
        tx<StoredRow[]>`
          select section_id as identity, to_jsonb(s) - 'term_code' as value
          from sections s where term_code = ${snapshot.active_planning_term}
        `,
        tx<StoredRow[]>`
          select section_id as identity,
            to_jsonb(m) - 'term_code' - 'section_id' - 'meeting_index' as value
          from meetings m where term_code = ${snapshot.active_planning_term}
        `,
        tx<StoredRow[]>`
          select i.instructor_name as identity,
            jsonb_build_object('instructor_name', i.instructor_name) as value
          from instructors i
          where exists (
            select 1 from section_instructors si
            where si.term_code = ${snapshot.active_planning_term}
              and si.instructor_name = i.instructor_name
          )
        `,
        tx<StoredRow[]>`
          select section_id || ':' || instructor_name as identity,
            to_jsonb(si) - 'term_code' as value
          from section_instructors si
          where term_code = ${snapshot.active_planning_term}
        `,
        tx<StoredRow[]>`
          select course_id as identity,
            jsonb_build_object(
              'raw_record', raw_record,
              'matched_via', matched_via
            ) as value
          from grade_archive_records
          where term_code = ${snapshot.active_planning_term}
        `,
        tx<StoredRow[]>`
          select section_id as identity,
            jsonb_build_object(
              'section_id', section_id,
              'enrolled', enrolled,
              'capacity', capacity,
              'waitlist_count', waitlist_count
            ) as value
          from snapshot_availability
          where term_code = ${snapshot.active_planning_term}
        `,
        tx<StoredRow[]>`
          select subject || ':' || source as identity,
            jsonb_build_object(
              'subject', subject,
              'source', source,
              'status', status,
              'reason', reason,
              'attempts', attempts,
              'row_counts', row_counts,
              'raw_artifacts', raw_artifacts,
              'normalized_artifact', normalized_artifact
            ) as value
          from import_manifest_cells
          where artifact_fingerprint = ${existingTerm?.artifactFingerprint ?? ''}
        `,
      ]);
      const storedMap = (rows: StoredRow[]) =>
        new Map(rows.map(({ identity, value }) => [identity, value]));
      const existing = {
        courses: storedMap(storedCourses),
        sections: storedMap(storedSections),
        meetings: multisetMap(
          storedMeetings,
          ({ identity }) => identity,
          ({ value }) => value,
        ),
        instructors: storedMap(storedInstructors),
        instructorLinks: storedMap(storedInstructorLinks),
        gradeRecords: multisetMap(
          storedGradeRecords,
          ({ identity }) => identity,
          ({ value }) => value,
          ({ value }) => ({
            raw_record: (value as { raw_record: unknown }).raw_record,
          }),
        ),
        availability: storedMap(storedAvailability),
        manifestCells: storedMap(storedManifestCells),
      };
      const replacing = Boolean(
        existingTerm && existingTerm.artifactFingerprint !== fingerprint,
      );
      const freezingExisting = Boolean(
        existingTerm?.lifecycle === 'published' &&
        existingTerm.artifactFingerprint === fingerprint &&
        lifecycle === 'frozen',
      );
      const summary: SnapshotImportSummary = {
        term: snapshot.active_planning_term,
        lifecycle,
        dryRun: Boolean(options.dryRun),
        courses: {
          ...changeCounts(incoming.courses, existing.courses),
          rejected: 0,
        },
        sections: changeCounts(incoming.sections, existing.sections),
        meetings: changeCounts(incoming.meetings, existing.meetings),
        instructors: changeCounts(incoming.instructors, existing.instructors),
        instructorLinks: changeCounts(
          incoming.instructorLinks,
          existing.instructorLinks,
        ),
        gradeRecords: changeCounts(
          incoming.gradeRecords,
          existing.gradeRecords,
        ),
        availabilityObservations: changeCounts(
          incoming.availability,
          existing.availability,
        ),
        manifestCells: changeCounts(
          incoming.manifestCells,
          existing.manifestCells,
        ),
        importRun: existingRun?.exists ? 'unchanged' : 'created',
      };
      if (options.dryRun) return summary;
      if (freezingExisting) {
        await tx`
          update supported_terms set snapshot_lifecycle = 'frozen'
          where term_code = ${snapshot.active_planning_term}
        `;
        await tx`
          update import_runs set snapshot_lifecycle = 'frozen'
          where artifact_fingerprint = ${fingerprint}
        `;
        await tx`
          update snapshot_availability set term_state = 'historical'
          where term_code = ${snapshot.active_planning_term}
        `;
        return summary;
      }
      if (existingRun?.exists) {
        for (const { courseId, record, recordIndex } of gradeRecords) {
          if (record.matched_via !== 'cross_listed') continue;
          await tx`
            update grade_archive_records
            set matched_via = ${record.matched_via}
            where term_code = ${snapshot.active_planning_term}
              and course_id = ${courseId}
              and record_index = ${recordIndex}
              and matched_via is distinct from ${record.matched_via}
          `;
        }
        return summary;
      }

      if (replacing) {
        await tx`delete from supported_terms where term_code = ${snapshot.active_planning_term}`;
        await options.afterTermRemoval?.();
        if (options.failAfterTermRemoval)
          throw new Error('Injected mid-import failure');
      }

      await tx`
        insert into import_runs (
          artifact_fingerprint, snapshot_run_id, generated_at, term_code,
          snapshot_lifecycle,
          schedule_source_timestamp, catalog_source_timestamp,
          grade_source_timestamp, manifest_fingerprint,
          manifest_ok, manifest_empty, manifest_failed, manifest_partial
        ) values (
          ${fingerprint}, ${snapshot.run_id}, ${snapshot.generated_at},
          ${snapshot.active_planning_term}, ${lifecycle},
          ${snapshot.source_timestamps.schedule_of_classes},
          ${snapshot.source_timestamps.general_catalog},
          ${snapshot.source_timestamps.instructor_grade_archive},
          ${manifestFingerprint}, ${manifestStatusCounts.ok},
          ${manifestStatusCounts.empty}, ${manifestStatusCounts.failed},
          ${manifestStatusCounts.partial}
        ) on conflict (artifact_fingerprint) do nothing
      `;
      await tx`
        insert into supported_terms (
          term_code, term_label, date_start, date_end,
          snapshot_generated_at, artifact_fingerprint, snapshot_lifecycle
        ) values (
          ${snapshot.active_planning_term}, ${snapshot.term_label},
          ${snapshot.term_date_range?.start ?? null},
          ${snapshot.term_date_range?.end ?? null}, ${snapshot.generated_at},
          ${fingerprint}, ${lifecycle}
        ) on conflict (term_code) do nothing
      `;

      if (snapshot.courses.length > 0) {
        await tx`
          insert into courses ${tx(
            snapshot.courses.map((course) => ({
              term_code: snapshot.active_planning_term,
              course_id: course.course_id,
              subject: course.subject,
              course_number: course.course_number,
              title: course.title,
              units: course.units,
              description: course.description,
              prerequisites_text: course.prerequisites_text,
              restrictions_text: course.restrictions_text,
              catalog_url: course.catalog_url,
            })),
          )}
          on conflict (term_code, course_id) do nothing
        `;
      }
      if (sections.length > 0) {
        await tx`
          insert into sections ${tx(
            sections.map((section) => ({
              term_code: snapshot.active_planning_term,
              section_id: section.section_id,
              course_id: section.course_id,
              section_code: section.section_code,
              meeting_type: section.meeting_type,
            })),
          )}
          on conflict (term_code, section_id) do nothing
        `;
      }
      if (meetings.length > 0) {
        await tx`
          insert into meetings ${tx(
            meetings.map((meeting) => ({
              term_code: snapshot.active_planning_term,
              section_id: meeting.sectionId,
              meeting_index: meeting.meetingIndex,
              days: meeting.days,
              meeting_date: meeting.date,
              start_time: meeting.start_time,
              end_time: meeting.end_time,
              building: meeting.building,
              room: meeting.room,
              is_tba: meeting.is_tba,
              meeting_type: meeting.meeting_type,
              raw_days: meeting.raw_days,
              raw_time: meeting.raw_time,
              raw_location: meeting.raw_location,
            })),
          )}
          on conflict (term_code, section_id, meeting_index) do nothing
        `;
      }
      if (instructorNames.length > 0) {
        await tx`
          insert into instructors ${tx(
            instructorNames.map((instructorName) => ({
              instructor_name: instructorName,
            })),
          )}
          on conflict (instructor_name) do nothing
        `;
      }
      if (instructorLinks.length > 0) {
        await tx`
          insert into section_instructors ${tx(
            instructorLinks.map((link) => ({
              term_code: snapshot.active_planning_term,
              section_id: link.sectionId,
              instructor_name: link.instructorName,
            })),
          )}
          on conflict (term_code, section_id, instructor_name) do nothing
        `;
      }
      if (gradeRecords.length > 0) {
        await tx`
          insert into grade_archive_records ${tx(
            gradeRecords.map(({ courseId, record, recordIndex }) => ({
              term_code: snapshot.active_planning_term,
              course_id: courseId,
              record_index: recordIndex,
              archive_subject: record.subject,
              archive_course: record.course,
              archive_year: record.year,
              archive_quarter: record.quarter,
              archive_title: record.title,
              instructor: record.instructor,
              gpa: record.gpa,
              a_percent: record.a,
              b_percent: record.b,
              c_percent: record.c,
              d_percent: record.d,
              f_percent: record.f,
              w_percent: record.w,
              p_percent: record.p,
              np_percent: record.np,
              raw_record: tx.json(record.raw),
              matched_via: record.matched_via ?? null,
            })),
          )}
          on conflict (term_code, course_id, record_index) do nothing
        `;
      }
      if (availabilityObservations.length > 0) {
        await tx`
          insert into snapshot_availability ${tx(
            availabilityObservations.map((observation) => ({
              term_code: snapshot.active_planning_term,
              section_id: observation.sectionId,
              enrolled: observation.enrolled,
              capacity: observation.capacity,
              waitlist_count: observation.waitlistCount,
              observed_at: snapshot.generated_at,
              term_state: termState,
            })),
          )}
          on conflict (term_code, section_id) do nothing
        `;
      }
      if (manifest.cells.length > 0) {
        await tx`
          insert into import_manifest_cells ${tx(
            manifest.cells.map((cell) => ({
              artifact_fingerprint: fingerprint,
              term_code: cell.term,
              subject: cell.subject,
              source: cell.source,
              status: cell.status,
              reason: cell.reason,
              attempts: cell.attempts,
              row_counts: tx.json(cell.row_counts),
              raw_artifacts: tx.json(cell.raw_artifacts),
              normalized_artifact: cell.normalized_artifact,
            })),
          )}
          on conflict (artifact_fingerprint, subject, source) do nothing
        `;
      }

      await tx`
        delete from instructors i
        where not exists (
          select 1 from section_instructors si
          where si.instructor_name = i.instructor_name
        )
      `;
      return summary;
    });
  } finally {
    await sql.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const lifecycleIndex = args.indexOf('--lifecycle');
  const lifecycleValue =
    lifecycleIndex === -1 ? 'published' : args[lifecycleIndex + 1];
  if (lifecycleValue !== 'published' && lifecycleValue !== 'frozen') {
    throw new LifecycleError(
      'lifecycle must be either published or frozen',
      'invalid_lifecycle',
    );
  }
  const positionalArgs = args.filter(
    (arg, index) =>
      arg !== '--dry-run' &&
      arg !== '--lifecycle' &&
      (lifecycleIndex === -1 || index !== lifecycleIndex + 1),
  );
  const [snapshotPath, manifestPath] = positionalArgs;
  const databaseUrl = process.env.COURSE_DATA_STORE_DATABASE_URL;
  if (!snapshotPath || !manifestPath)
    throw new Error('usage: importSnapshot.mts <snapshot> <manifest>');
  if (!databaseUrl)
    throw new Error('env config missing: COURSE_DATA_STORE_DATABASE_URL');
  console.log(
    JSON.stringify(
      await importSnapshot(snapshotPath, databaseUrl, manifestPath, {
        dryRun,
        lifecycle: lifecycleValue,
      }),
    ),
  );
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    const invalidSnapshot =
      error instanceof Error && error.message.startsWith('Published Snapshot');
    const rejection = error instanceof ImportRejection ? error : undefined;
    const lifecycleError = error instanceof LifecycleError ? error : undefined;
    const inferredGroup =
      rejection?.group ??
      (invalidSnapshot
        ? 'courses'
        : error instanceof Error && error.message.includes('Manifest')
          ? 'manifestCells'
          : undefined);
    const emptyGroup = {
      created: 0,
      updated: 0,
      unchanged: 0,
      removed: 0,
      rejected: 0,
      identities: {
        created: [] as string[],
        updated: [] as string[],
        unchanged: [] as string[],
        removed: [] as string[],
        rejected: [] as string[],
      },
    };
    const groups: { [key: string]: typeof emptyGroup } = Object.fromEntries(
      [
        'courses',
        'sections',
        'meetings',
        'instructors',
        'instructorLinks',
        'gradeRecords',
        'availabilityObservations',
        'manifestCells',
      ].map((group) => [group, structuredClone(emptyGroup)]),
    );
    if (inferredGroup) {
      groups[inferredGroup] = {
        ...structuredClone(emptyGroup),
        rejected: Math.max(1, rejection?.identities.length ?? 0),
        identities: {
          ...structuredClone(emptyGroup.identities),
          rejected: rejection?.identities.slice(0, 20) ?? [],
        },
      };
    }
    console.error(
      JSON.stringify({
        result: 'rejected',
        reason:
          lifecycleError?.reason ??
          rejection?.reason ??
          (invalidSnapshot
            ? 'invalid_snapshot'
            : inferredGroup === 'manifestCells'
              ? 'invalid_manifest'
              : 'import_failed'),
        ...groups,
      }),
    );
    process.exitCode = 1;
  });
}
