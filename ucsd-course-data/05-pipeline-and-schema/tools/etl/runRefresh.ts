/**
 * One-command ETL refresh orchestrator. Encodes the full refresh sequence
 * that was previously run by hand (see docs/etl_refresh.md and ADR 0041):
 *
 * 1. Discover the live Schedule of Classes Term Window and the Class Planner
 *    term registry, and fail on source conflicts before mutating anything.
 * 2. Preserve the published-catalog before-state for the refresh report.
 * 3. Run the multi-term Schedule of Classes pipeline.
 * 4. For each Class-Planner-sourced term: fetch the catalog, convert it to
 *    tss-chatbot-v1, and publish the TSS snapshot. This must follow step 3 so
 *    the term's registry entry stays active rather than frozen.
 * 5. Rewrite the generated supported-terms list from the final registry.
 * 6. Run the credential-free deployment validators.
 * 7. Diff before/after published JSON into the refresh report.
 */

import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  planClassplannerTerms,
  selectPrimaryMetadataDirectory,
} from './refreshPlan';
import {
  buildRefreshReport,
  captureCatalogState,
  renderRefreshReportMarkdown,
  writeRefreshReport,
  type EtlRefreshReport,
  type ManifestSummary,
} from './refreshReport';
import { withSpan } from './telemetry';
import type { CatalogSnapshotConfig } from '../catalog-snapshot/catalogSnapshot';
import { runMultiTermSnapshotPipeline } from '../catalog-snapshot/multiTermPipeline';
import type { PublishedSnapshotSourceLoaders } from '../catalog-snapshot/publishedSnapshotPipeline';
import { readSupportedTermRegistry } from '../catalog-snapshot/supportedTermRegistry';
import {
  discoverTermWindow,
  enumerateCandidateTerms,
  type TermDescriptor,
} from '../catalog-snapshot/termWindow';
import {
  inferredNormalizedRunTimestamp,
  runTssPublishedSnapshotPipeline,
} from '../catalog-snapshot/tssPublishedSnapshotPipeline';
import {
  fetchClassplannerCatalog,
  fetchClassplannerTerms,
} from '../classplanner-scraper/classplannerCatalog';
import { convertClassplannerRunToTss } from '../classplanner-scraper/classplannerToTss';

const defaultSupportedTermsPath = 'frontend/src/generated/supported-terms.json';

export type EtlRefreshOptions = {
  config: CatalogSnapshotConfig;
  /** Injectable for tests; every live source request goes through this. */
  fetch?: typeof fetch;
  /** Explicit Term Window (skips live discovery); used by tests. */
  terms?: TermDescriptor[];
  candidateYears?: number[];
  sourceLoaders?: PublishedSnapshotSourceLoaders;
  classplannerBaseUrl?: string;
  /** Defaults to `<config.paths.raw_dir>/classplanner`. */
  classplannerOutRoot?: string;
  supportedTermsPath?: string;
  classplannerRequestDelayMs?: number;
  runValidators?: () => Promise<void>;
  generatedAt?: string;
  log?: (line: string) => void;
};

export type EtlRefreshResult = {
  generatedAt: string;
  scheduleOfClassesTerms: string[];
  classplannerTerms: string[];
  supportedTerms: string[];
  report: EtlRefreshReport;
  reportDirectory: string;
  reportPaths: { jsonPath: string; markdownPath: string };
};

function defaultCandidateYears(): number[] {
  const currentYear = new Date().getUTCFullYear();
  return [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${command} ${args.join(' ')} exited with code ${String(code)}`,
          ),
        );
      }
    });
  });
}

async function defaultRunValidators(): Promise<void> {
  await runCommand('bun', ['run', 'validate:staging-deployment']);
  await runCommand('bun', ['run', 'validate:production-deployment']);
}

export async function runEtlRefresh(
  options: EtlRefreshOptions,
): Promise<EtlRefreshResult> {
  const { config } = options;
  const log = options.log ?? console.log;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const classplannerOutRoot =
    options.classplannerOutRoot ?? join(config.paths.raw_dir, 'classplanner');
  const supportedTermsPath =
    options.supportedTermsPath ?? defaultSupportedTermsPath;

  // 1. Discover both source windows before mutating anything, so a source
  // conflict aborts with the repository untouched.
  const socDescriptors =
    options.terms ??
    (await withSpan('etl.discover_term_window', {}, () =>
      discoverTermWindow(
        enumerateCandidateTerms(
          options.candidateYears ?? defaultCandidateYears(),
        ),
        { fetch: options.fetch },
      ),
    ));
  const scheduleOfClassesTerms = socDescriptors.map(
    (descriptor) => descriptor.term,
  );
  log(`Schedule of Classes window: ${scheduleOfClassesTerms.join(', ')}`);

  const plannerRegistry = await withSpan(
    'etl.fetch_classplanner_terms',
    {},
    () =>
      fetchClassplannerTerms({
        baseUrl: options.classplannerBaseUrl,
        fetch: options.fetch,
      }),
  );
  const classplannerPlan = planClassplannerTerms(
    plannerRegistry.terms,
    scheduleOfClassesTerms,
  );
  const classplannerTerms = classplannerPlan.map((entry) => entry.term);
  log(`Class Planner terms: ${classplannerTerms.join(', ') || '(none)'}`);

  // 2. Preserve the before-state for the refresh report.
  const reportDirectory = join(
    config.paths.reports_dir,
    'etl',
    generatedAt.replace(/[:.]/gu, '-'),
  );
  const beforePublicDirectory = join(reportDirectory, 'before', 'public');
  await captureCatalogState(
    config.paths.public_catalog_dir,
    beforePublicDirectory,
  );

  const manifestSummaries: { [term: string]: ManifestSummary } = {};

  // 3. Schedule of Classes multi-term refresh.
  const socResult = await withSpan(
    'etl.soc_refresh',
    { 'etl.terms': scheduleOfClassesTerms.join(',') },
    () =>
      runMultiTermSnapshotPipeline(config, {
        terms: socDescriptors,
        generatedAt,
        fetch: options.fetch,
        sourceLoaders: options.sourceLoaders,
      }),
  );
  for (const { descriptor, result } of socResult.terms)
    manifestSummaries[descriptor.term] = result.manifest.summary;

  // 4. Class Planner terms. Publishing after step 3 keeps each term's
  // registry entry active instead of frozen.
  for (const { term } of classplannerPlan) {
    await withSpan(
      'etl.classplanner_refresh',
      { 'etl.term': term },
      async () => {
        const fetched = await fetchClassplannerCatalog({
          term,
          outRoot: classplannerOutRoot,
          baseUrl: options.classplannerBaseUrl,
          fetch: options.fetch,
          requestDelayMs: options.classplannerRequestDelayMs,
          log,
        });
        const conversion = await convertClassplannerRunToTss({
          runDirectory: fetched.runDirectory,
        });
        log(
          `${term}: converted ${conversion.courses} courses into ` +
            `${conversion.booking_choices} booking choices`,
        );
        const runNames = await readdir(config.paths.normalized_dir);
        const metadataDirectory = join(
          config.paths.normalized_dir,
          selectPrimaryMetadataDirectory(runNames, config.active_planning_term),
        );
        const metadataSourceTimestamp =
          inferredNormalizedRunTimestamp(metadataDirectory);
        if (!metadataSourceTimestamp) {
          throw new Error(
            `Cannot infer the normalized run timestamp from ${metadataDirectory}`,
          );
        }
        const published = await runTssPublishedSnapshotPipeline({
          config,
          rawDirectory: join(fetched.runDirectory, 'tss'),
          metadataDirectory,
          metadataRootDirectory: config.paths.normalized_dir,
          metadataSourceTimestamp,
          generatedAt,
        });
        manifestSummaries[published.snapshot.active_planning_term] =
          published.manifest.summary;
        log(
          `${term}: published ${published.snapshotPath} ` +
            `(manifest ok=${published.manifest.summary.ok} ` +
            `failed=${published.manifest.summary.failed})`,
        );
      },
    );
  }

  // 5. The generated supported-terms list follows the final registry state.
  const registry = await readSupportedTermRegistry(config.paths.metadata_path);
  if (!registry) {
    throw new Error(
      `No Supported Term registry at ${config.paths.metadata_path} after refresh`,
    );
  }
  const supportedTerms = registry.terms.map((entry) => entry.term);
  await mkdir(dirname(supportedTermsPath), { recursive: true });
  await writeFile(
    supportedTermsPath,
    `${JSON.stringify(supportedTerms, null, 2)}\n`,
    'utf-8',
  );

  // 6. Credential-free deployment validators.
  await withSpan('etl.validators', {}, () =>
    (options.runValidators ?? defaultRunValidators)(),
  );

  // 7. Refresh report from the preserved before-state.
  const report = await withSpan('etl.report', {}, () =>
    buildRefreshReport({
      beforePublicDirectory,
      afterPublicDirectory: config.paths.public_catalog_dir,
      generatedAt,
      manifestSummaries,
    }),
  );
  const reportPaths = await writeRefreshReport(report, reportDirectory);
  log(renderRefreshReportMarkdown(report));

  return {
    generatedAt,
    scheduleOfClassesTerms,
    classplannerTerms,
    supportedTerms,
    report,
    reportDirectory,
    reportPaths,
  };
}
