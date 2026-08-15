import { writeFile } from 'node:fs/promises';
import { loadCatalogSnapshotConfig } from './catalogSnapshot.js';
import { runMultiTermSnapshotPipeline } from './multiTermPipeline.js';

// The catalog term selector imports this generated list (UCSD alpha term
// codes) so it stays in sync with the published Term Archive. See ADR 0012.
const supportedTermsPath = 'frontend/src/generated/supported-terms.json';

function readConfigPath() {
  const index = process.argv.indexOf('--config');
  if (index === -1) return 'config/catalog-snapshot.ucsd.yaml';
  const value = process.argv[index + 1];
  if (!value) throw new Error('--config requires a path');
  return value;
}

try {
  const config = await loadCatalogSnapshotConfig(readConfigPath());
  const result = await runMultiTermSnapshotPipeline(config);

  const supportedTerms = result.registry.terms.map((entry) => entry.term);
  await writeFile(
    supportedTermsPath,
    `${JSON.stringify(supportedTerms, null, 2)}\n`,
    'utf-8',
  );

  console.log(
    JSON.stringify(
      {
        metadata_path: result.metadataPath,
        supported_terms_path: supportedTermsPath,
        terms: result.terms.map(({ descriptor, result: termResult }) => ({
          term: descriptor.term,
          label: descriptor.label,
          status: termResult.report.status,
          snapshot_path: termResult.snapshotPath,
          manifest_path: termResult.manifestPath,
        })),
      },
      null,
      2,
    ),
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
