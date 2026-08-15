import { randomUUID } from 'node:crypto';
import type { CatalogSnapshot, CatalogSnapshotConfig } from './catalogSnapshot';
import {
  defaultSourceLoaders,
  runPublishedSnapshotPipeline,
  type PublishedSnapshotSourceLoadContext,
  type PublishedSnapshotPipelineResult,
  type PublishedSnapshotSourceLoaders,
} from './publishedSnapshotPipeline';
import {
  createFileSnapshotStorage,
  type SnapshotStorage,
} from './snapshotStorage';
import {
  buildSupportedTermRegistry,
  readSupportedTermRegistry,
  supportedTermManifestPath,
  supportedTermSnapshotPath,
  writeSupportedTermRegistry,
  type SupportedTermEntry,
  type SupportedTermRegistry,
} from './supportedTermRegistry';
import {
  discoverTermWindow,
  enumerateCandidateTerms,
  type TermDescriptor,
} from './termWindow';

type FetchAdapter = typeof fetch;
type TermDateRange = CatalogSnapshot['term_date_range'];
const defaultMultiTermFetchDelayMs = 100;

export type MultiTermSnapshotPipelineResult = {
  registry: SupportedTermRegistry;
  metadataPath: string;
  terms: {
    descriptor: TermDescriptor;
    result: PublishedSnapshotPipelineResult;
  }[];
};

/**
 * Memoize a source loader by subject so a term-agnostic source (General
 * Catalog, Instructor Grade Archive) is fetched once per subject across the
 * whole multi-term run instead of once per term. See ADR 0012.
 */
function memoizeByKey<C, R>(
  loader: (subject: string, context: C) => R,
  keyFor: (subject: string, context: C) => string,
): (subject: string, context: C) => R {
  const cache = new Map<string, R>();
  return (subject, context) => {
    const key = keyFor(subject, context);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const value = loader(subject, context);
    cache.set(key, value);
    return value;
  };
}

function sharedLoaders(
  base: PublishedSnapshotSourceLoaders,
): PublishedSnapshotSourceLoaders {
  return {
    // Schedule of Classes is term-specific: fetched per term.
    scheduleOfClasses: base.scheduleOfClasses,
    // Term-agnostic sources are fetched once per subject and reused per term.
    generalCatalog: memoizeByKey(
      base.generalCatalog,
      (subject, context: PublishedSnapshotSourceLoadContext) =>
        `${subject}:${context.catalogPageBySubject?.[subject] ?? subject}`,
    ),
    instructorGradeArchive: memoizeByKey(
      base.instructorGradeArchive,
      (subject) => subject,
    ),
  };
}

/**
 * Generate one Published Snapshot per term in the Term Window and write a
 * single Supported Term registry to the configured metadata path.
 * Term-agnostic sources are fetched once. The set of terms is discovered by
 * probing the source unless an explicit term list is injected. See ADR 0012.
 */
export async function runMultiTermSnapshotPipeline(
  config: CatalogSnapshotConfig,
  options: {
    terms?: TermDescriptor[];
    candidateYears?: number[];
    termDateRanges?: { [term: string]: TermDateRange };
    fetch?: FetchAdapter;
    generatedAt?: string;
    runId?: string;
    sourceLoaders?: PublishedSnapshotSourceLoaders;
    fetchDelayMs?: number;
    storage?: SnapshotStorage;
  } = {},
): Promise<MultiTermSnapshotPipelineResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runId = options.runId ?? `multi-${generatedAt}-${randomUUID()}`;
  const storage = options.storage ?? createFileSnapshotStorage();

  const terms =
    options.terms ??
    (await discoverTermWindow(
      enumerateCandidateTerms(
        options.candidateYears ?? defaultCandidateYears(),
      ),
      { fetch: options.fetch },
    ));

  const loaders = sharedLoaders(
    options.sourceLoaders ?? defaultSourceLoaders(),
  );

  const termResults: MultiTermSnapshotPipelineResult['terms'] = [];
  const entries: SupportedTermEntry[] = [];

  for (const descriptor of terms) {
    const perTermConfig: CatalogSnapshotConfig = {
      ...config,
      active_planning_term: descriptor.term,
      term_label: descriptor.label,
      term_date_range: resolveTermDateRange(config, descriptor.term, options),
      configured_subjects: descriptor.subjects ?? config.configured_subjects,
    };

    const result = await runPublishedSnapshotPipeline(perTermConfig, {
      runId: `${runId}-${descriptor.term}`,
      generatedAt,
      fetch: options.fetch,
      sourceLoaders: loaders,
      writeMetadata: false,
      storage,
      fetchDelayMs: options.fetchDelayMs ?? defaultMultiTermFetchDelayMs,
      subjectList: descriptor.subjectList,
    });

    termResults.push({ descriptor, result });
    entries.push({
      term: descriptor.term,
      label: descriptor.label,
      date_range: perTermConfig.term_date_range,
      frozen: false,
      generated_at: generatedAt,
      snapshot_path: supportedTermSnapshotPath(descriptor.term),
      manifest_path: supportedTermManifestPath(descriptor.term),
    });
  }

  const existingRegistry = await readSupportedTermRegistry(
    config.paths.metadata_path,
    storage,
  );
  const registry = buildSupportedTermRegistry(
    mergeCurrentAndFrozenEntries(entries, existingRegistry),
    generatedAt,
  );
  const metadataPath = await writeSupportedTermRegistry(
    registry,
    config.paths.metadata_path,
    storage,
  );

  return { registry, metadataPath, terms: termResults };
}

function mergeCurrentAndFrozenEntries(
  currentEntries: SupportedTermEntry[],
  existingRegistry: SupportedTermRegistry | null,
): SupportedTermEntry[] {
  if (!existingRegistry?.terms) return currentEntries;

  const currentTerms = new Set(currentEntries.map((entry) => entry.term));
  const frozenEntries = existingRegistry.terms
    .filter((entry) => !currentTerms.has(entry.term))
    .map((entry) => ({
      ...entry,
      frozen: true,
    }));

  return [...currentEntries, ...frozenEntries];
}

function resolveTermDateRange(
  config: CatalogSnapshotConfig,
  term: string,
  options: { termDateRanges?: { [term: string]: TermDateRange } },
): TermDateRange {
  const override =
    options.termDateRanges?.[term] ?? config.term_date_ranges?.[term];
  if (override !== undefined) return override;
  // The source cannot supply term dates; only the configured term has a known
  // range. Discovered terms are null until a calendar source is wired.
  if (term === config.active_planning_term) return config.term_date_range;
  return null;
}

function defaultCandidateYears(): number[] {
  const currentYear = new Date().getUTCFullYear();
  return [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];
}
