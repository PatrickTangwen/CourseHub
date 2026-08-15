import { loadCatalogSnapshotConfig } from './catalogSnapshot.js';
import {
  inferredNormalizedRunTimestamp,
  runTssPublishedSnapshotPipeline,
} from './tssPublishedSnapshotPipeline.js';

function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${name} requires a value`);
  }
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

try {
  const config = await loadCatalogSnapshotConfig(
    argument('--config', 'config/catalog-snapshot.ucsd.yaml'),
  );
  const rawDirectory = argument('--raw-dir');
  const metadataDirectory = argument('--metadata-dir');
  const metadataSourceTimestamp = process.argv.includes('--metadata-timestamp')
    ? argument('--metadata-timestamp')
    : inferredNormalizedRunTimestamp(metadataDirectory);
  if (!metadataSourceTimestamp) {
    throw new Error(
      '--metadata-timestamp is required when it cannot be inferred from the metadata directory',
    );
  }
  const result = await runTssPublishedSnapshotPipeline({
    config,
    rawDirectory,
    metadataDirectory,
    metadataRootDirectory: process.argv.includes('--metadata-root')
      ? argument('--metadata-root')
      : undefined,
    metadataCutoffTimestamp: process.argv.includes('--metadata-cutoff')
      ? argument('--metadata-cutoff')
      : undefined,
    metadataSourceTimestamp,
  });
  console.log(
    JSON.stringify(
      {
        run_id: result.snapshot.run_id,
        active_planning_term: result.snapshot.active_planning_term,
        coverage: result.snapshot.coverage,
        availability_supplement: result.availabilitySupplement,
        snapshot_path: result.snapshotPath,
        manifest_path: result.manifestPath,
        manifest_summary: result.manifest.summary,
        metadata_path: result.metadataPath,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
