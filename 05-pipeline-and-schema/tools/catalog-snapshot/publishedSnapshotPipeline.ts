import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import pathModule from 'node:path';
import {
  attachGeneralCatalogMetadata,
  attachGradeArchiveRecords,
  publishCatalogSnapshot,
  validateCatalogSnapshot,
  type CatalogSnapshot,
  type CatalogSnapshotConfig,
  type ValidationResult,
} from './catalogSnapshot';
import {
  fetchRawGeneralCatalogForSubject,
  parseGeneralCatalogHtml,
  type GeneralCatalogCourse,
} from './generalCatalog';
import {
  fetchRawInstructorGradeArchiveForSubject,
  parseInstructorGradeArchiveHtml,
  type GradeArchiveRecord,
} from './instructorGradeArchive';
import {
  buildScheduleCatalogSnapshot,
  fetchRawScheduleOfClassesForSubject,
  parseScheduleOfClassesHtml,
  type ParsedScheduleOfClasses,
  type SubjectListSource,
} from './scheduleOfClasses';
import {
  createFileSnapshotStorage,
  type SnapshotStorage,
} from './snapshotStorage';

type FetchAdapter = typeof fetch;
export type SourceKind =
  | 'schedule_of_classes'
  | 'general_catalog'
  | 'instructor_grade_archive';
type PipelineStatus = 'published' | 'failed';
type ImportManifestCellStatus = 'ok' | 'empty' | 'failed' | 'partial';

type RawSourceFile = {
  filename: string;
  contents: string;
};

type ParsedSource<T> = {
  source_timestamp: string | null;
  data: T;
};

type SourceLoad<T> = {
  subject: string;
  fetched_at: string;
  raw_files: RawSourceFile[];
  parse: () => ParsedSource<T> | Promise<ParsedSource<T>>;
};

type SourceLoader<T> = (
  subject: string,
  context: PublishedSnapshotSourceLoadContext,
) => SourceLoad<T> | Promise<SourceLoad<T>>;

export type PublishedSnapshotSourceLoadContext = {
  config: CatalogSnapshotConfig;
  runId: string;
  generatedAt: string;
  fetch?: FetchAdapter;
  subjectList?: SubjectListSource;
  catalogPageBySubject?: { [subject: string]: string };
};

export type PublishedSnapshotSourceLoaders = {
  scheduleOfClasses: SourceLoader<ParsedScheduleOfClasses>;
  generalCatalog: SourceLoader<GeneralCatalogCourse[]>;
  instructorGradeArchive: SourceLoader<GradeArchiveRecord[]>;
};

type PipelineError = {
  source: SourceKind | 'publish';
  subject: string | null;
  phase: 'fetch' | 'parse' | 'write' | 'publish';
  message: string;
  attempts?: number;
};

type StepResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: PipelineError;
    };

type CollectedSource<T> = {
  source: SourceKind;
  subject: string;
  fetched_at: string;
  source_timestamp: string | null;
  raw_artifacts: string[];
  normalized_artifact: string;
  data: T;
};

export type ImportManifestCell = {
  term: string;
  subject: string;
  source: SourceKind;
  status: ImportManifestCellStatus;
  reason: string | null;
  attempts: number;
  row_counts: { [key: string]: number };
  raw_artifacts: string[];
  normalized_artifact: string | null;
};

export type PublishedSnapshotImportManifest = {
  run_id: string;
  generated_at: string;
  active_planning_term: string;
  term_label: string;
  configured_subjects: string[];
  systemic_parser_failure_threshold: number;
  cells: ImportManifestCell[];
  summary: {
    ok: number;
    empty: number;
    failed: number;
    partial: number;
  };
};

export type PublishedSnapshotImportReport = {
  run_id: string;
  generated_at: string;
  active_planning_term: string;
  term_label: string;
  configured_subjects: string[];
  status: PipelineStatus;
  source_timestamps: CatalogSnapshot['source_timestamps'];
  sources: {
    source: SourceKind;
    subject: string;
    fetched_at: string;
    source_timestamp: string | null;
    raw_artifacts: string[];
    normalized_artifact: string;
    row_counts: { [key: string]: number };
  }[];
  row_counts: {
    schedule_of_classes: {
      courses: number;
      sections: number;
      meetings: number;
      by_subject: {
        [key: string]: { courses: number; sections: number; meetings: number };
      };
    };
    general_catalog: {
      courses: number;
      by_subject: { [key: string]: { courses: number } };
    };
    instructor_grade_archive: {
      records: number;
      by_subject: { [key: string]: { records: number } };
    };
    catalog_snapshot: {
      courses: number;
      sections: number;
    };
  };
  validation: ValidationResult;
  errors: PipelineError[];
  parser_errors: PipelineError[];
  raw_artifacts: string[];
  normalized_artifacts: string[];
  staging_snapshot_path: string | null;
  published_snapshot_path: string | null;
  metadata_path: string | null;
};

export type PublishedSnapshotPipelineResult = {
  report: PublishedSnapshotImportReport;
  reportPath: string;
  snapshotPath: string;
  metadataPath: string | null;
  manifest: PublishedSnapshotImportManifest;
  manifestPath: string;
};

type RunPaths = {
  rawRoot: string;
  normalizedRoot: string;
  reportPath: string;
  manifestPath: string;
};

function defaultRunId(generatedAt: string): string {
  const timestamp = generatedAt.replace(/[^\dA-Za-z]+/gu, '-');
  return `published-${timestamp}-${randomUUID()}`;
}

function safePathComponent(value: string): string {
  const normalized = value.trim().replace(/[^\w.-]+/gu, '_');
  return normalized || 'source';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function writeJson(pathname: string, value: unknown) {
  return writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

async function writeRawFiles(
  paths: RunPaths,
  source: SourceKind,
  files: RawSourceFile[],
): Promise<string[]> {
  const sourceDir = pathModule.join(paths.rawRoot, source);
  await mkdir(sourceDir, { recursive: true });
  const writtenPaths: string[] = [];

  for (const file of files) {
    const filename = safePathComponent(pathModule.basename(file.filename));
    const artifactPath = pathModule.join(sourceDir, filename);
    await writeFile(artifactPath, file.contents, 'utf-8');
    writtenPaths.push(artifactPath);
  }

  return writtenPaths;
}

async function writeNormalized<T>(
  paths: RunPaths,
  source: SourceKind,
  subject: string,
  data: T,
): Promise<string> {
  const sourceDir = pathModule.join(paths.normalizedRoot, source);
  await mkdir(sourceDir, { recursive: true });
  const artifactPath = pathModule.join(
    sourceDir,
    `${safePathComponent(subject)}.json`,
  );
  await writeJson(artifactPath, data);
  return artifactPath;
}

async function runStep<T>(
  errorContext: Omit<PipelineError, 'message'>,
  action: () => T | Promise<T>,
): Promise<StepResult<T>> {
  try {
    return {
      ok: true,
      value: await action(),
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        ...errorContext,
        message: errorMessage(err),
      },
    };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runRetriableStep<T>(
  errorContext: Omit<PipelineError, 'message'>,
  options: { maxAttempts: number; retryDelayMs: number },
  action: () => T | Promise<T>,
): Promise<StepResult<T> & { attempts: number }> {
  const maxAttempts = Math.max(1, options.maxAttempts);
  let latestError: PipelineError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runStep(errorContext, action);
    if (result.ok) return { ...result, attempts: attempt };
    latestError = { ...result.error, attempts: attempt };
    if (attempt < maxAttempts && options.retryDelayMs > 0)
      await sleep(options.retryDelayMs);
  }

  return {
    ok: false,
    error: latestError ?? {
      ...errorContext,
      message: 'step failed without an error',
      attempts: maxAttempts,
    },
    attempts: maxAttempts,
  };
}

function emptyReason(source: SourceKind, rowCounts: { [key: string]: number }) {
  const totalRows = Object.values(rowCounts).reduce(
    (count, value) => count + value,
    0,
  );
  if (totalRows > 0) return null;
  if (source === 'schedule_of_classes')
    return 'no Schedule of Classes rows for subject in term';
  if (source === 'general_catalog')
    return 'no General Catalog rows for subject';
  return 'no Instructor Grade Archive rows for subject';
}

function manifestSummary(cells: ImportManifestCell[]) {
  return {
    ok: cells.filter((cell) => cell.status === 'ok').length,
    empty: cells.filter((cell) => cell.status === 'empty').length,
    failed: cells.filter((cell) => cell.status === 'failed').length,
    partial: cells.filter((cell) => cell.status === 'partial').length,
  };
}

export function buildPublishedSnapshotImportManifest(options: {
  config: CatalogSnapshotConfig;
  runId: string;
  generatedAt: string;
  systemicParserFailureThreshold: number;
  cells: ImportManifestCell[];
}): PublishedSnapshotImportManifest {
  return {
    run_id: options.runId,
    generated_at: options.generatedAt,
    active_planning_term: options.config.active_planning_term,
    term_label: options.config.term_label,
    configured_subjects: options.config.configured_subjects,
    systemic_parser_failure_threshold: options.systemicParserFailureThreshold,
    cells: options.cells,
    summary: manifestSummary(options.cells),
  };
}

async function collectSources<T>(
  source: SourceKind,
  subjects: string[],
  loader: SourceLoader<T>,
  context: PublishedSnapshotSourceLoadContext,
  paths: RunPaths,
  options: {
    maxFetchAttempts: number;
    fetchRetryDelayMs: number;
    fetchDelayMs: number;
  },
  rowCountsForData: (data: T) => { [key: string]: number },
): Promise<{
  collected: CollectedSource<T>[];
  errors: PipelineError[];
  cells: ImportManifestCell[];
}> {
  const collected: CollectedSource<T>[] = [];
  const errors: PipelineError[] = [];
  const cells: ImportManifestCell[] = [];

  for (const subject of subjects) {
    if (collected.length + errors.length > 0 && options.fetchDelayMs > 0)
      await sleep(options.fetchDelayMs);

    const sourceLoadResult = await runRetriableStep(
      { source, subject, phase: 'fetch' },
      {
        maxAttempts: options.maxFetchAttempts,
        retryDelayMs: options.fetchRetryDelayMs,
      },
      () => loader(subject, context),
    );
    if (!sourceLoadResult.ok) {
      errors.push(sourceLoadResult.error);
      cells.push({
        term: context.config.active_planning_term,
        subject,
        source,
        status: 'failed',
        reason: sourceLoadResult.error.message,
        attempts: sourceLoadResult.attempts,
        row_counts: {},
        raw_artifacts: [],
        normalized_artifact: null,
      });
      continue;
    }
    const sourceLoad = sourceLoadResult.value;

    const rawArtifactsResult = await runStep(
      { source, subject, phase: 'write' },
      () => writeRawFiles(paths, source, sourceLoad.raw_files),
    );
    if (!rawArtifactsResult.ok) {
      errors.push(rawArtifactsResult.error);
      cells.push({
        term: context.config.active_planning_term,
        subject,
        source,
        status: 'failed',
        reason: rawArtifactsResult.error.message,
        attempts: sourceLoadResult.attempts,
        row_counts: {},
        raw_artifacts: [],
        normalized_artifact: null,
      });
      continue;
    }
    const rawArtifacts = rawArtifactsResult.value;

    const parsedResult = await runStep(
      { source, subject, phase: 'parse' },
      sourceLoad.parse,
    );
    if (!parsedResult.ok) {
      errors.push(parsedResult.error);
      cells.push({
        term: context.config.active_planning_term,
        subject,
        source,
        status: 'failed',
        reason: parsedResult.error.message,
        attempts: sourceLoadResult.attempts,
        row_counts: {},
        raw_artifacts: rawArtifacts,
        normalized_artifact: null,
      });
      continue;
    }
    const parsed = parsedResult.value;
    const rowCounts = rowCountsForData(parsed.data);
    const emptyCellReason = emptyReason(source, rowCounts);

    const normalizedArtifactResult = await runStep(
      { source, subject, phase: 'write' },
      () => writeNormalized(paths, source, sourceLoad.subject, parsed.data),
    );
    if (!normalizedArtifactResult.ok) {
      errors.push(normalizedArtifactResult.error);
      cells.push({
        term: context.config.active_planning_term,
        subject: sourceLoad.subject,
        source,
        status: 'failed',
        reason: normalizedArtifactResult.error.message,
        attempts: sourceLoadResult.attempts,
        row_counts: rowCounts,
        raw_artifacts: rawArtifacts,
        normalized_artifact: null,
      });
      continue;
    }

    collected.push({
      source,
      subject: sourceLoad.subject,
      fetched_at: sourceLoad.fetched_at,
      source_timestamp: parsed.source_timestamp,
      raw_artifacts: rawArtifacts,
      normalized_artifact: normalizedArtifactResult.value,
      data: parsed.data,
    });
    cells.push({
      term: context.config.active_planning_term,
      subject: sourceLoad.subject,
      source,
      status: emptyCellReason ? 'empty' : 'ok',
      reason: emptyCellReason,
      attempts: sourceLoadResult.attempts,
      row_counts: rowCounts,
      raw_artifacts: rawArtifacts,
      normalized_artifact: normalizedArtifactResult.value,
    });
  }

  return { collected, errors, cells };
}

function firstTimestamp<T>(sources: CollectedSource<T>[]): string | null {
  return (
    sources.find((source) => source.source_timestamp)?.source_timestamp ??
    sources[0]?.fetched_at ??
    null
  );
}

function scheduleSubjectCounts(parsed: ParsedScheduleOfClasses) {
  const sections = parsed.courses.flatMap((course) => course.sections);
  return {
    courses: parsed.courses.length,
    sections: sections.length,
    meetings: sections.reduce(
      (count, section) => count + section.meetings.length,
      0,
    ),
  };
}

function buildScheduleRowCounts(
  sources: CollectedSource<ParsedScheduleOfClasses>[],
) {
  const bySubject: {
    [key: string]: { courses: number; sections: number; meetings: number };
  } = {};
  for (const source of sources)
    bySubject[source.subject] = scheduleSubjectCounts(source.data);

  return {
    courses: Object.values(bySubject).reduce(
      (count, subject) => count + subject.courses,
      0,
    ),
    sections: Object.values(bySubject).reduce(
      (count, subject) => count + subject.sections,
      0,
    ),
    meetings: Object.values(bySubject).reduce(
      (count, subject) => count + subject.meetings,
      0,
    ),
    by_subject: bySubject,
  };
}

function buildGeneralCatalogRowCounts(
  sources: CollectedSource<GeneralCatalogCourse[]>[],
) {
  const bySubject: { [key: string]: { courses: number } } = {};
  for (const source of sources)
    bySubject[source.subject] = { courses: source.data.length };

  return {
    courses: Object.values(bySubject).reduce(
      (count, subject) => count + subject.courses,
      0,
    ),
    by_subject: bySubject,
  };
}

function buildGradeArchiveRowCounts(
  sources: CollectedSource<GradeArchiveRecord[]>[],
) {
  const bySubject: { [key: string]: { records: number } } = {};
  for (const source of sources)
    bySubject[source.subject] = { records: source.data.length };

  return {
    records: Object.values(bySubject).reduce(
      (count, subject) => count + subject.records,
      0,
    ),
    by_subject: bySubject,
  };
}

function buildCatalogSnapshotRowCounts(snapshot: CatalogSnapshot | null) {
  if (!snapshot) return { courses: 0, sections: 0 };
  return {
    courses: snapshot.courses.length,
    sections: snapshot.courses.reduce(
      (count, course) => count + course.sections.length,
      0,
    ),
  };
}

function sourceRowCounts(
  source: CollectedSource<
    ParsedScheduleOfClasses | GeneralCatalogCourse[] | GradeArchiveRecord[]
  >,
): { [key: string]: number } {
  if (source.source === 'schedule_of_classes')
    return scheduleSubjectCounts(source.data as ParsedScheduleOfClasses);

  if (source.source === 'general_catalog') {
    return {
      courses: (source.data as GeneralCatalogCourse[]).length,
    };
  }

  return {
    records: (source.data as GradeArchiveRecord[]).length,
  };
}

function generalCatalogRowCounts(data: GeneralCatalogCourse[]) {
  return { courses: data.length };
}

function gradeArchiveRowCounts(data: GradeArchiveRecord[]) {
  return { records: data.length };
}

function sourceReport(
  source: CollectedSource<
    ParsedScheduleOfClasses | GeneralCatalogCourse[] | GradeArchiveRecord[]
  >,
) {
  return {
    source: source.source,
    subject: source.subject,
    fetched_at: source.fetched_at,
    source_timestamp: source.source_timestamp,
    raw_artifacts: source.raw_artifacts,
    normalized_artifact: source.normalized_artifact,
    row_counts: sourceRowCounts(source),
  };
}

export function publishedSnapshotImportManifestPath(
  config: CatalogSnapshotConfig,
): string {
  return pathModule.join(
    pathModule.dirname(config.paths.public_catalog_dir),
    'import-manifests',
    `${config.active_planning_term}.json`,
  );
}

function systemicParserErrors(options: {
  errors: PipelineError[];
  subjects: string[];
  threshold: number;
}): PipelineError[] {
  const subjectsBySource = new Map<SourceKind, Set<string>>();
  for (const error of options.errors) {
    if (error.source === 'publish') continue;
    if (error.phase !== 'parse') continue;
    if (!error.subject) continue;
    const subjects = subjectsBySource.get(error.source) ?? new Set<string>();
    subjects.add(error.subject);
    subjectsBySource.set(error.source, subjects);
  }

  const configuredCount = Math.max(1, options.subjects.length);
  const systemicSources = new Set<SourceKind>();
  for (const [source, subjects] of subjectsBySource) {
    if (subjects.size / configuredCount > options.threshold)
      systemicSources.add(source);
  }

  return options.errors.filter(
    (error) =>
      error.source !== 'publish' &&
      systemicSources.has(error.source) &&
      error.phase === 'parse',
  );
}

function publishImportManifest(
  manifest: PublishedSnapshotImportManifest,
  pathname: string,
  storage: SnapshotStorage,
): Promise<string> {
  return storage.writeJson(pathname, manifest);
}

function buildReport(options: {
  config: CatalogSnapshotConfig;
  runId: string;
  generatedAt: string;
  status: PipelineStatus;
  scheduleSources: CollectedSource<ParsedScheduleOfClasses>[];
  generalCatalogSources: CollectedSource<GeneralCatalogCourse[]>[];
  gradeArchiveSources: CollectedSource<GradeArchiveRecord[]>[];
  snapshot: CatalogSnapshot | null;
  validation: ValidationResult;
  errors: PipelineError[];
  parserErrors: PipelineError[];
  stagingSnapshotPath: string | null;
  publishedSnapshotPath: string | null;
  metadataPath: string | null;
}): PublishedSnapshotImportReport {
  const allSources = [
    ...options.scheduleSources,
    ...options.generalCatalogSources,
    ...options.gradeArchiveSources,
  ];
  return {
    run_id: options.runId,
    generated_at: options.generatedAt,
    active_planning_term: options.config.active_planning_term,
    term_label: options.config.term_label,
    configured_subjects: options.config.configured_subjects,
    status: options.status,
    source_timestamps: {
      schedule_of_classes: firstTimestamp(options.scheduleSources),
      general_catalog: firstTimestamp(options.generalCatalogSources),
      instructor_grade_archive: firstTimestamp(options.gradeArchiveSources),
    },
    sources: allSources.map(sourceReport),
    row_counts: {
      schedule_of_classes: buildScheduleRowCounts(options.scheduleSources),
      general_catalog: buildGeneralCatalogRowCounts(
        options.generalCatalogSources,
      ),
      instructor_grade_archive: buildGradeArchiveRowCounts(
        options.gradeArchiveSources,
      ),
      catalog_snapshot: buildCatalogSnapshotRowCounts(options.snapshot),
    },
    validation: options.validation,
    errors: options.errors,
    parser_errors: options.parserErrors,
    raw_artifacts: allSources.flatMap((source) => source.raw_artifacts),
    normalized_artifacts: [
      ...allSources.map((source) => source.normalized_artifact),
      ...(options.stagingSnapshotPath ? [options.stagingSnapshotPath] : []),
    ],
    staging_snapshot_path: options.stagingSnapshotPath,
    published_snapshot_path: options.publishedSnapshotPath,
    metadata_path: options.metadataPath,
  };
}

export function defaultSourceLoaders(): PublishedSnapshotSourceLoaders {
  return {
    async scheduleOfClasses(subject, context) {
      const rawSource = await fetchRawScheduleOfClassesForSubject(subject, {
        term: context.config.active_planning_term,
        fetch: context.fetch,
        fetchedAt: context.generatedAt,
        subjectList: context.subjectList,
      });
      return {
        subject: rawSource.subject,
        fetched_at: rawSource.fetched_at,
        raw_files: [
          {
            filename: `${safePathComponent(subject)}.subject-list.json`,
            contents: rawSource.subject_list_raw,
          },
          {
            filename: `${safePathComponent(subject)}.html`,
            contents: rawSource.html,
          },
        ],
        parse() {
          const parsed = parseScheduleOfClassesHtml(rawSource.html, {
            subject,
            term: context.config.active_planning_term,
            sourceUrl: rawSource.source_url,
            fetchedAt: rawSource.fetched_at,
          });
          return {
            source_timestamp: parsed.source_timestamp,
            data: parsed,
          };
        },
      };
    },
    async generalCatalog(subject, context) {
      const rawSource = await fetchRawGeneralCatalogForSubject(subject, {
        fetch: context.fetch,
        fetchedAt: context.generatedAt,
        catalogPage: context.catalogPageBySubject?.[subject],
      });
      return {
        subject: rawSource.subject,
        fetched_at: rawSource.fetched_at,
        raw_files: [
          {
            filename: `${safePathComponent(subject)}.html`,
            contents: rawSource.html,
          },
        ],
        parse() {
          return {
            source_timestamp: rawSource.fetched_at,
            data: parseGeneralCatalogHtml(rawSource.html, {
              subject,
              sourceUrl: rawSource.source_url,
            }),
          };
        },
      };
    },
    async instructorGradeArchive(subject, context) {
      const rawSource = await fetchRawInstructorGradeArchiveForSubject(
        subject,
        {
          fetch: context.fetch,
          fetchedAt: context.generatedAt,
        },
      );
      return {
        subject: rawSource.subject,
        fetched_at: rawSource.fetched_at,
        raw_files: [
          {
            filename: `${safePathComponent(subject)}.html`,
            contents: rawSource.html,
          },
        ],
        parse() {
          return {
            source_timestamp: rawSource.fetched_at,
            data: parseInstructorGradeArchiveHtml(rawSource.html),
          };
        },
      };
    },
  };
}

function buildSnapshot(options: {
  config: CatalogSnapshotConfig;
  runId: string;
  generatedAt: string;
  scheduleSources: CollectedSource<ParsedScheduleOfClasses>[];
  generalCatalogSources: CollectedSource<GeneralCatalogCourse[]>[];
  gradeArchiveSources: CollectedSource<GradeArchiveRecord[]>[];
}): CatalogSnapshot {
  const baseSnapshot = buildScheduleCatalogSnapshot(
    options.config,
    options.scheduleSources.map((source) => source.data),
    {
      runId: options.runId,
      generatedAt: options.generatedAt,
    },
  );
  const catalogCourses = options.generalCatalogSources.flatMap(
    (source) => source.data,
  );
  const gradeArchiveRecords = options.gradeArchiveSources.flatMap(
    (source) => source.data,
  );
  const enrichedSnapshot = attachGradeArchiveRecords(
    attachGeneralCatalogMetadata(baseSnapshot, catalogCourses),
    gradeArchiveRecords,
  );

  return {
    ...enrichedSnapshot,
    source_timestamps: {
      schedule_of_classes: firstTimestamp(options.scheduleSources),
      general_catalog: firstTimestamp(options.generalCatalogSources),
      instructor_grade_archive: firstTimestamp(options.gradeArchiveSources),
    },
  };
}

export async function runPublishedSnapshotPipeline(
  config: CatalogSnapshotConfig,
  options: {
    runId?: string;
    generatedAt?: string;
    fetch?: FetchAdapter;
    sourceLoaders?: PublishedSnapshotSourceLoaders;
    writeMetadata?: boolean;
    maxFetchAttempts?: number;
    fetchRetryDelayMs?: number;
    fetchDelayMs?: number;
    subjectList?: SubjectListSource;
    systemicParserFailureThreshold?: number;
    storage?: SnapshotStorage;
  } = {},
): Promise<PublishedSnapshotPipelineResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runId = options.runId ?? defaultRunId(generatedAt);
  const maxFetchAttempts = options.maxFetchAttempts ?? 3;
  const fetchRetryDelayMs = options.fetchRetryDelayMs ?? 250;
  const fetchDelayMs = options.fetchDelayMs ?? 0;
  const systemicParserFailureThreshold =
    options.systemicParserFailureThreshold ?? 0.5;
  const storage = options.storage ?? createFileSnapshotStorage();
  const paths = {
    rawRoot: pathModule.join(config.paths.raw_dir, runId),
    normalizedRoot: pathModule.join(config.paths.normalized_dir, runId),
    reportPath: pathModule.join(
      config.paths.reports_dir,
      `${runId}.import-report.json`,
    ),
    manifestPath: publishedSnapshotImportManifestPath(config),
  };
  const context: PublishedSnapshotSourceLoadContext = {
    config,
    runId,
    generatedAt,
    fetch: options.fetch,
    subjectList: options.subjectList,
  };
  const sourceLoaders = options.sourceLoaders ?? defaultSourceLoaders();

  const scheduleResult = await collectSources(
    'schedule_of_classes',
    config.configured_subjects,
    sourceLoaders.scheduleOfClasses,
    context,
    paths,
    { maxFetchAttempts, fetchRetryDelayMs, fetchDelayMs },
    scheduleSubjectCounts,
  );
  context.catalogPageBySubject = catalogPageBySubject(scheduleResult.collected);
  const generalCatalogResult = await collectSources(
    'general_catalog',
    config.configured_subjects,
    sourceLoaders.generalCatalog,
    context,
    paths,
    { maxFetchAttempts, fetchRetryDelayMs, fetchDelayMs },
    generalCatalogRowCounts,
  );
  const gradeArchiveResult = await collectSources(
    'instructor_grade_archive',
    config.configured_subjects,
    sourceLoaders.instructorGradeArchive,
    context,
    paths,
    { maxFetchAttempts, fetchRetryDelayMs, fetchDelayMs },
    gradeArchiveRowCounts,
  );
  const sourceErrors = [
    ...scheduleResult.errors,
    ...generalCatalogResult.errors,
    ...gradeArchiveResult.errors,
  ];
  const manifestCells = [
    ...scheduleResult.cells,
    ...generalCatalogResult.cells,
    ...gradeArchiveResult.cells,
  ];
  const manifest = buildPublishedSnapshotImportManifest({
    config,
    runId,
    generatedAt,
    systemicParserFailureThreshold,
    cells: manifestCells,
  });
  const systemicErrors = systemicParserErrors({
    errors: sourceErrors,
    subjects: config.configured_subjects,
    threshold: systemicParserFailureThreshold,
  });

  await mkdir(config.paths.reports_dir, { recursive: true });

  if (systemicErrors.length) {
    const report = buildReport({
      config,
      runId,
      generatedAt,
      status: 'failed',
      scheduleSources: scheduleResult.collected,
      generalCatalogSources: generalCatalogResult.collected,
      gradeArchiveSources: gradeArchiveResult.collected,
      snapshot: null,
      validation: {
        success: false,
        errors: [
          'validation was not run because source parsing failed systemically',
        ],
      },
      errors: systemicErrors,
      parserErrors: systemicErrors,
      stagingSnapshotPath: null,
      publishedSnapshotPath: null,
      metadataPath: null,
    });
    await writeJson(paths.reportPath, report);
    throw new Error(
      `Published Snapshot systemic parser failure:\n${systemicErrors
        .map((error) => error.message)
        .join('\n')}`,
    );
  }

  const snapshot = buildSnapshot({
    config,
    runId,
    generatedAt,
    scheduleSources: scheduleResult.collected,
    generalCatalogSources: generalCatalogResult.collected,
    gradeArchiveSources: gradeArchiveResult.collected,
  });
  const stagingSnapshotPath = pathModule.join(
    paths.normalizedRoot,
    'catalog_snapshot.staging.json',
  );
  await mkdir(paths.normalizedRoot, { recursive: true });
  await writeJson(stagingSnapshotPath, snapshot);

  const validation = validateCatalogSnapshot(snapshot, config);
  if (!validation.success) {
    const report = buildReport({
      config,
      runId,
      generatedAt,
      status: 'failed',
      scheduleSources: scheduleResult.collected,
      generalCatalogSources: generalCatalogResult.collected,
      gradeArchiveSources: gradeArchiveResult.collected,
      snapshot,
      validation,
      errors: sourceErrors,
      parserErrors: sourceErrors.filter((error) => error.phase === 'parse'),
      stagingSnapshotPath,
      publishedSnapshotPath: null,
      metadataPath: null,
    });
    await writeJson(paths.reportPath, report);
    throw new Error(
      `Catalog Snapshot validation failed:\n${validation.errors.join('\n')}`,
    );
  }

  try {
    const publishResult = await publishCatalogSnapshot(snapshot, config, {
      writeMetadata: options.writeMetadata,
      storage,
    });
    const manifestPath = await publishImportManifest(
      manifest,
      paths.manifestPath,
      storage,
    );
    const report = buildReport({
      config,
      runId,
      generatedAt,
      status: 'published',
      scheduleSources: scheduleResult.collected,
      generalCatalogSources: generalCatalogResult.collected,
      gradeArchiveSources: gradeArchiveResult.collected,
      snapshot,
      validation,
      errors: sourceErrors,
      parserErrors: [],
      stagingSnapshotPath,
      publishedSnapshotPath: publishResult.snapshotPath,
      metadataPath: publishResult.metadataPath,
    });
    await writeJson(paths.reportPath, report);
    return {
      report,
      reportPath: paths.reportPath,
      snapshotPath: publishResult.snapshotPath,
      metadataPath: publishResult.metadataPath,
      manifest,
      manifestPath,
    };
  } catch (err) {
    const errors = [
      ...sourceErrors,
      {
        source: 'publish' as const,
        subject: null,
        phase: 'publish' as const,
        message: errorMessage(err),
      },
    ];
    const report = buildReport({
      config,
      runId,
      generatedAt,
      status: 'failed',
      scheduleSources: scheduleResult.collected,
      generalCatalogSources: generalCatalogResult.collected,
      gradeArchiveSources: gradeArchiveResult.collected,
      snapshot,
      validation,
      errors,
      parserErrors: sourceErrors.filter((error) => error.phase === 'parse'),
      stagingSnapshotPath,
      publishedSnapshotPath: null,
      metadataPath: null,
    });
    await writeJson(paths.reportPath, report);
    throw err;
  }
}

function catalogPageFromUrl(value: string | null): string | null {
  if (!value) return null;
  const match = /\/courses\/(?<page>[^/#?]+)\.html/iu.exec(value);
  const page = match?.groups?.page;
  return page ? page.toUpperCase() : null;
}

function catalogPageBySubject(
  scheduleSources: CollectedSource<ParsedScheduleOfClasses>[],
): { [subject: string]: string } {
  const pageCountsBySubject = new Map<string, Map<string, number>>();

  for (const source of scheduleSources) {
    const { subject } = source;
    const pageCounts =
      pageCountsBySubject.get(subject) ?? new Map<string, number>();
    pageCountsBySubject.set(subject, pageCounts);

    for (const course of source.data.courses) {
      const page = catalogPageFromUrl(course.catalog_url);
      if (!page) continue;
      pageCounts.set(page, (pageCounts.get(page) ?? 0) + 1);
    }
  }

  const pagesBySubject: { [subject: string]: string } = {};
  for (const [subject, pageCounts] of pageCountsBySubject.entries()) {
    const [page] = [...pageCounts.entries()].sort(
      ([pageA, countA], [pageB, countB]) =>
        countB - countA || pageA.localeCompare(pageB),
    )[0] ?? [subject];
    pagesBySubject[subject] = page;
  }

  return pagesBySubject;
}
