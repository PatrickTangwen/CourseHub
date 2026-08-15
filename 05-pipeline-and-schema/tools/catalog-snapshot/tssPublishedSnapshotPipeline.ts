import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import {
  gradeArchiveCourseId,
  publishCatalogSnapshot,
  type CatalogSnapshot,
  type CatalogSnapshotConfig,
} from './catalogSnapshot';
import type { GeneralCatalogCourse } from './generalCatalog';
import type { GradeArchiveRecord } from './instructorGradeArchive';
import {
  buildPublishedSnapshotImportManifest,
  publishedSnapshotImportManifestPath,
  type ImportManifestCell,
  type PublishedSnapshotImportManifest,
} from './publishedSnapshotPipeline';
import { createFileSnapshotStorage } from './snapshotStorage';
import {
  buildSupportedTermRegistry,
  readSupportedTermRegistry,
  supportedTermManifestPath,
  supportedTermSnapshotPath,
  writeSupportedTermRegistry,
} from './supportedTermRegistry';
import {
  applyTssAvailabilitySupplement,
  parseTssAvailabilitySupplement,
} from './tssAvailabilitySupplement';
import {
  buildTssCatalogSnapshot,
  parseTssRequestedSubjects,
  tssCourseIds,
  type TssCatalogSnapshotSources,
} from './tssSchedule';

const tssIdentitySchema = z.object({
  term: z.string().min(1),
  requested_course: z.string().min(1).optional(),
  coverage: z.object({
    complete: z.boolean(),
    continuation_needed: z.boolean(),
    omitted_courses: z.array(z.string().min(1)).optional(),
  }),
  courses: z.array(
    z.object({
      tss_course_code: z.string().min(1),
    }),
  ),
});

type NamedJsonFile = { fileName: string; value: unknown };

type ScheduleManifestOptions = {
  term: string;
  subjects: string[];
  snapshot: CatalogSnapshot;
  rawDirectory: string;
  namedResponses: NamedJsonFile[];
  availabilitySupplementPath: string | null;
  availabilitySupplementSubjects: Set<string>;
};

type NormalizedManifestOptions<T> = {
  term: string;
  subjects: string[];
  source: 'general_catalog' | 'instructor_grade_archive';
  metadataBySubject: Map<string, NormalizedSubjectMetadata<T>>;
  rowCountName: 'courses' | 'records';
};

type NormalizedSubjectMetadata<T> = {
  artifactPath: string;
  sourceTimestamp: string | null;
  values: T[];
};

type NormalizedMetadataSelection<T> = {
  bySubject: Map<string, NormalizedSubjectMetadata<T>>;
  sourceTimestamp: string | null;
};

type NormalizedMetadataSelectionOptions<T> = {
  directories: string[];
  primaryDirectory: string;
  source: 'general_catalog' | 'instructor_grade_archive';
  primarySourceTimestamp: string;
  scheduledCourseIds: Set<string>;
  courseId: (value: T) => string;
};

const termNames: { [prefix: string]: string } = {
  FA: 'Fall',
  S1: 'Summer Session 1',
  S2: 'Summer Session 2',
  S3: 'Summer Session 3',
  SP: 'Spring',
  SU: 'Summer',
  WI: 'Winter',
};

function termLabel(term: string): string {
  const match = /^(?<prefix>WI|SP|S1|S2|S3|SU|FA)(?<year>\d{2})$/u.exec(term);
  const prefix = match?.groups?.prefix;
  const year = match?.groups?.year;
  return prefix && year ? `${termNames[prefix] ?? prefix} 20${year}` : term;
}

async function jsonFileNames(directory: string): Promise<string[]> {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
}

async function readNamedJsonFiles(directory: string) {
  const fileNames = await jsonFileNames(directory);
  return Promise.all(
    fileNames.map(async (fileName) => ({
      fileName,
      value: JSON.parse(
        await readFile(path.join(directory, fileName), 'utf-8'),
      ) as unknown,
    })),
  );
}

async function optionalNamedJsonFiles(directory: string) {
  try {
    return await readNamedJsonFiles(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function tssTerm(responses: unknown[]): string {
  const terms = new Set(
    responses.map((response) => tssIdentitySchema.parse(response).term),
  );
  if (terms.size !== 1)
    throw new Error('TSS responses must contain exactly one term');
  return terms.values().next().value!;
}

function tssResponseSubjects(response: unknown): string[] {
  const parsed = tssIdentitySchema.parse(response);
  return [
    ...parseTssRequestedSubjects(parsed.requested_course),
    ...parsed.courses.map((course) =>
      course.tss_course_code.split('-', 1)[0]!.trim().toUpperCase(),
    ),
  ];
}

function tssSubjects(responses: unknown[]): string[] {
  return responses.flatMap(tssResponseSubjects);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export type TssPublishedSnapshotPipelineOptions = {
  config: CatalogSnapshotConfig;
  rawDirectory: string;
  metadataDirectory: string;
  metadataRootDirectory?: string;
  metadataCutoffTimestamp?: string;
  metadataSourceTimestamp: string;
  runId?: string;
  generatedAt?: string;
  availabilitySupplementPath?: string;
};

export type TssPublishedSnapshotPipelineResult = {
  snapshot: CatalogSnapshot;
  snapshotPath: string;
  metadataPath: string | null;
  manifest: PublishedSnapshotImportManifest;
  manifestPath: string;
  availabilitySupplement: {
    path: string;
    records: number;
    matchedRecords: number;
    updatedComponents: number;
    overriddenValues: number;
    unmatchedRecords: number;
    unmatchedKeys: string[];
  } | null;
};

async function optionalTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function inferredNormalizedRunTimestamp(
  directory: string,
): string | null {
  const match = /multi-(?<timestamp>\d{4}-\d{2}-\d{2}T[^/]+?Z)-/u.exec(
    path.basename(directory),
  );
  return match?.groups?.timestamp ?? null;
}

async function normalizedRunDirectories(
  primaryDirectory: string,
  rootDirectory?: string,
  cutoffTimestamp?: string,
): Promise<string[]> {
  const directories = new Set([primaryDirectory]);
  if (!rootDirectory) return [...directories];

  const entries = await readdir(rootDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(rootDirectory, entry.name);
    const timestamp = inferredNormalizedRunTimestamp(directory);
    if (cutoffTimestamp && timestamp && timestamp > cutoffTimestamp) continue;
    directories.add(directory);
  }
  return [...directories].sort();
}

function coveredScheduledCourseCount<T>(
  candidate: NormalizedSubjectMetadata<T>,
  scheduledCourseIds: Set<string>,
  courseId: (value: T) => string,
): number {
  return new Set(
    candidate.values
      .map(courseId)
      .filter((candidateCourseId) => scheduledCourseIds.has(candidateCourseId)),
  ).size;
}

function preferNormalizedCandidate<T>(
  current: NormalizedSubjectMetadata<T> | undefined,
  candidate: NormalizedSubjectMetadata<T>,
  scheduledCourseIds: Set<string>,
  courseId: (value: T) => string,
): boolean {
  if (!current) return true;
  const currentCoverage = coveredScheduledCourseCount(
    current,
    scheduledCourseIds,
    courseId,
  );
  const candidateCoverage = coveredScheduledCourseCount(
    candidate,
    scheduledCourseIds,
    courseId,
  );
  if (candidateCoverage !== currentCoverage)
    return candidateCoverage > currentCoverage;
  const timestampComparison = (candidate.sourceTimestamp ?? '').localeCompare(
    current.sourceTimestamp ?? '',
  );
  if (timestampComparison !== 0) return timestampComparison > 0;
  return candidate.artifactPath.localeCompare(current.artifactPath) > 0;
}

async function selectNormalizedMetadata<T>(
  options: NormalizedMetadataSelectionOptions<T>,
): Promise<NormalizedMetadataSelection<T>> {
  const bySubject = new Map<string, NormalizedSubjectMetadata<T>>();
  for (const directory of options.directories) {
    const sourceDirectory = path.join(directory, options.source);
    const files = await optionalNamedJsonFiles(sourceDirectory);
    for (const { fileName, value } of files) {
      if (!Array.isArray(value)) {
        throw new Error(
          `${path.join(sourceDirectory, fileName)} must contain an array`,
        );
      }
      const subject = path.basename(fileName, '.json').toUpperCase();
      const candidate = {
        artifactPath: path.join(sourceDirectory, fileName),
        sourceTimestamp:
          inferredNormalizedRunTimestamp(directory) ??
          (directory === options.primaryDirectory
            ? options.primarySourceTimestamp
            : null),
        values: value as T[],
      };
      if (
        preferNormalizedCandidate(
          bySubject.get(subject),
          candidate,
          options.scheduledCourseIds,
          options.courseId,
        )
      )
        bySubject.set(subject, candidate);
    }
  }

  const sourceTimestamps = new Set(
    [...bySubject.values()].map(({ sourceTimestamp }) => sourceTimestamp),
  );
  return {
    bySubject,
    sourceTimestamp:
      sourceTimestamps.size === 1 && !sourceTimestamps.has(null)
        ? (sourceTimestamps.values().next().value ?? null)
        : null,
  };
}

function isCompleteTssResponse(response: unknown): boolean {
  const { coverage } = tssIdentitySchema.parse(response);
  return (
    coverage.complete &&
    !coverage.continuation_needed &&
    (coverage.omitted_courses?.length ?? 0) === 0
  );
}

function scheduleRowCounts(snapshot: CatalogSnapshot, subject: string) {
  const courses = snapshot.courses.filter(
    (course) => course.subject === subject,
  );
  const sections = courses.flatMap((course) => course.sections);
  return {
    courses: courses.length,
    sections: sections.length,
    meetings: sections.reduce(
      (count, section) => count + section.meetings.length,
      0,
    ),
  };
}

function scheduleCellState(
  matchingResponses: { value: unknown }[],
  hasRows: boolean,
): Pick<ImportManifestCell, 'status' | 'reason'> {
  if (matchingResponses.length === 0)
    return { status: 'failed', reason: 'no TSS response covers subject' };
  if (matchingResponses.some(({ value }) => !isCompleteTssResponse(value))) {
    return {
      status: 'partial',
      reason:
        'batch-level TSS response reports incomplete coverage; subject completeness is unknown',
    };
  }
  if (!hasRows) {
    return {
      status: 'empty',
      reason: 'no TSS schedule rows for subject in term',
    };
  }
  return { status: 'ok', reason: null };
}

function scheduleManifestCells(
  options: ScheduleManifestOptions,
): ImportManifestCell[] {
  return options.subjects.map((subject) => {
    const matchingResponses = options.namedResponses.filter(({ value }) =>
      tssResponseSubjects(value).includes(subject),
    );
    const rowCounts = scheduleRowCounts(options.snapshot, subject);
    const hasRows = Object.values(rowCounts).some((count) => count > 0);
    const rawArtifacts = matchingResponses.map(({ fileName }) =>
      path.join(options.rawDirectory, fileName),
    );
    if (
      matchingResponses.length &&
      options.availabilitySupplementPath &&
      options.availabilitySupplementSubjects.has(subject)
    )
      rawArtifacts.push(options.availabilitySupplementPath);

    const { status, reason } = scheduleCellState(matchingResponses, hasRows);

    return {
      term: options.term,
      subject,
      source: 'schedule_of_classes',
      status,
      reason,
      attempts: matchingResponses.length ? 1 : 0,
      row_counts: rowCounts,
      raw_artifacts: rawArtifacts,
      normalized_artifact: null,
    };
  });
}

function normalizedManifestCells<T>(
  options: NormalizedManifestOptions<T>,
): ImportManifestCell[] {
  return options.subjects.map((subject) => {
    const metadata = options.metadataBySubject.get(subject);
    const values = metadata?.values;
    const status =
      values === undefined ? 'failed' : values.length ? 'ok' : 'empty';
    return {
      term: options.term,
      subject,
      source: options.source,
      status,
      reason:
        values === undefined
          ? 'normalized metadata artifact is missing'
          : values.length
            ? null
            : `no ${options.source === 'general_catalog' ? 'General Catalog rows' : 'Instructor Grade Archive rows'} for subject`,
      attempts: values === undefined ? 0 : 1,
      row_counts: { [options.rowCountName]: values?.length ?? 0 },
      raw_artifacts: [],
      normalized_artifact: metadata?.artifactPath ?? null,
    };
  });
}

/** Reads raw TSS files and normalized metadata, then publishes one artifact. */
export async function runTssPublishedSnapshotPipeline(
  options: TssPublishedSnapshotPipelineOptions,
): Promise<TssPublishedSnapshotPipelineResult> {
  const namedResponses = await readNamedJsonFiles(options.rawDirectory);
  let responses = namedResponses.map(({ value }) => value);
  if (responses.length === 0)
    throw new Error(`No TSS JSON files found in ${options.rawDirectory}`);
  const availabilitySupplementPath =
    options.availabilitySupplementPath ??
    path.join(options.rawDirectory, 'capacity_enrollment_supp.txt');
  const availabilitySupplementContents = await optionalTextFile(
    availabilitySupplementPath,
  );
  const availabilitySupplementRecords = availabilitySupplementContents
    ? parseTssAvailabilitySupplement(availabilitySupplementContents)
    : null;
  const availabilitySupplement =
    availabilitySupplementRecords !== null
      ? applyTssAvailabilitySupplement(responses, availabilitySupplementRecords)
      : null;
  if (availabilitySupplement) ({ responses } = availabilitySupplement);

  const metadataDirectories = await normalizedRunDirectories(
    options.metadataDirectory,
    options.metadataRootDirectory,
    options.metadataCutoffTimestamp,
  );
  const scheduledCourseIds = tssCourseIds(responses);
  const generalCatalog = await selectNormalizedMetadata<GeneralCatalogCourse>({
    directories: metadataDirectories,
    primaryDirectory: options.metadataDirectory,
    source: 'general_catalog',
    primarySourceTimestamp: options.metadataSourceTimestamp,
    scheduledCourseIds,
    courseId: (course) => course.course_id,
  });
  const gradeArchive = await selectNormalizedMetadata<GradeArchiveRecord>({
    directories: metadataDirectories,
    primaryDirectory: options.metadataDirectory,
    source: 'instructor_grade_archive',
    primarySourceTimestamp: options.metadataSourceTimestamp,
    scheduledCourseIds,
    courseId: gradeArchiveCourseId,
  });
  const generalCatalogCourses = [...generalCatalog.bySubject.values()].flatMap(
    ({ values }) => values,
  );
  const gradeArchiveRecords = [...gradeArchive.bySubject.values()].flatMap(
    ({ values }) => values,
  );
  const term = tssTerm(responses);
  const configuredSubjects = uniqueSorted([
    ...options.config.configured_subjects,
    ...tssSubjects(responses),
  ]);
  const config: CatalogSnapshotConfig = {
    ...options.config,
    active_planning_term: term,
    term_label: termLabel(term),
    term_date_range: options.config.term_date_ranges?.[term] ?? null,
    configured_subjects: configuredSubjects,
  };
  const metadataSources: Pick<
    TssCatalogSnapshotSources,
    'generalCatalog' | 'gradeArchive'
  > = {
    generalCatalog: {
      sourceTimestamp: generalCatalog.sourceTimestamp,
      courses: generalCatalogCourses,
    },
    gradeArchive: {
      sourceTimestamp: gradeArchive.sourceTimestamp,
      records: gradeArchiveRecords,
    },
  };
  const snapshot = buildTssCatalogSnapshot(config, responses, {
    ...metadataSources,
    runId: options.runId,
    generatedAt: options.generatedAt,
  });
  const published = await publishCatalogSnapshot(snapshot, config, {
    writeMetadata: false,
  });
  const manifest = buildPublishedSnapshotImportManifest({
    config,
    runId: snapshot.run_id,
    generatedAt: snapshot.generated_at,
    systemicParserFailureThreshold: 0.5,
    cells: [
      ...scheduleManifestCells({
        term,
        subjects: configuredSubjects,
        snapshot,
        rawDirectory: options.rawDirectory,
        namedResponses,
        availabilitySupplementPath: availabilitySupplement
          ? availabilitySupplementPath
          : null,
        availabilitySupplementSubjects: new Set(
          availabilitySupplementRecords?.map(({ subject }) => subject) ?? [],
        ),
      }),
      ...normalizedManifestCells({
        term,
        subjects: configuredSubjects,
        source: 'general_catalog',
        metadataBySubject: generalCatalog.bySubject,
        rowCountName: 'courses',
      }),
      ...normalizedManifestCells({
        term,
        subjects: configuredSubjects,
        source: 'instructor_grade_archive',
        metadataBySubject: gradeArchive.bySubject,
        rowCountName: 'records',
      }),
    ],
  });
  const manifestPath = await createFileSnapshotStorage().writeJson(
    publishedSnapshotImportManifestPath(config),
    manifest,
  );
  const currentEntry = {
    term,
    label: config.term_label,
    date_range: config.term_date_range,
    frozen: false,
    generated_at: snapshot.generated_at,
    snapshot_path: supportedTermSnapshotPath(term),
    manifest_path: supportedTermManifestPath(term),
  };
  const existingRegistry = await readSupportedTermRegistry(
    config.paths.metadata_path,
  );
  const preservedEntries = (existingRegistry?.terms ?? []).filter(
    (entry) => entry.term !== term,
  );
  const registry = buildSupportedTermRegistry(
    [currentEntry, ...preservedEntries],
    snapshot.generated_at,
  );
  const metadataPath = await writeSupportedTermRegistry(
    registry,
    config.paths.metadata_path,
  );
  return {
    snapshot,
    snapshotPath: published.snapshotPath,
    metadataPath,
    manifest,
    manifestPath,
    availabilitySupplement: availabilitySupplement
      ? {
          path: availabilitySupplementPath,
          records: availabilitySupplement.records,
          matchedRecords: availabilitySupplement.matchedRecords,
          updatedComponents: availabilitySupplement.updatedComponents,
          overriddenValues: availabilitySupplement.overriddenValues,
          unmatchedRecords: availabilitySupplement.unmatchedRecords,
          unmatchedKeys: availabilitySupplement.unmatchedKeys,
        }
      : null,
  };
}
