import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const packageRoot = resolve(import.meta.dirname, '..');
const repositoryExportRoot = join(
  packageRoot,
  '01-current-published-data',
  'api',
  'static',
);
const liveRoot = join(
  packageRoot,
  '01-current-published-data',
  'live-production-api-2026-08-15',
);
const historyRoot = join(packageRoot, '02-complete-local-data-history');
const reportPath = join(import.meta.dirname, 'package-validation-report.json');

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const repositoryMetadata = await readJson(
  join(repositoryExportRoot, 'metadata.json'),
);
const liveMetadata = await readJson(join(liveRoot, 'metadata.json'));
const downloadManifest = await readJson(
  join(liveRoot, 'download-manifest.json'),
);
const repositoryTerms = repositoryMetadata.terms
  .map((entry) => entry.term)
  .sort();
const liveTerms = liveMetadata.terms.map((entry) => entry.term).sort();
const termResults = [];
const missingArtifacts = [];

for (const term of repositoryTerms) {
  const monolithic = await readJson(
    join(repositoryExportRoot, 'catalogs', 'public', `${term}.json`),
  );
  const manifest = await readJson(
    join(repositoryExportRoot, 'catalogs', 'import-manifests', `${term}.json`),
  );
  const liveList = await readJson(join(liveRoot, 'public', `${term}.json`));
  const liveDetails = await readJson(join(liveRoot, 'details', `${term}.json`));
  const detailsByCourseId = new Map(
    liveDetails.courses.map((course) => [course.course_id, course]),
  );
  const reconstructed = {
    ...liveList,
    courses: liveList.courses.map((course) => ({
      ...course,
      grade_archive_records:
        detailsByCourseId.get(course.course_id)?.grade_archive_records ?? [],
    })),
  };

  let referencedArtifacts = 0;
  let missingForTerm = 0;
  for (const cell of manifest.cells ?? []) {
    const paths = [
      ...(cell.raw_artifacts ?? []),
      ...(cell.normalized_artifact ? [cell.normalized_artifact] : []),
    ];
    for (const artifact of paths) {
      if (!artifact.startsWith('data/')) continue;
      referencedArtifacts += 1;
      if (!(await exists(join(historyRoot, artifact)))) {
        missingForTerm += 1;
        missingArtifacts.push({ term, artifact });
      }
    }
  }

  termResults.push({
    term,
    generated_at: monolithic.generated_at,
    courses: monolithic.courses.length,
    list_detail_reconstructs_repository_snapshot: isDeepStrictEqual(
      reconstructed,
      monolithic,
    ),
    live_list_and_detail_course_ids_match:
      liveList.courses.length === liveDetails.courses.length &&
      liveList.courses.every(
        (course, index) =>
          course.course_id === liveDetails.courses[index]?.course_id,
      ),
    manifest_matches_snapshot:
      manifest.generated_at === monolithic.generated_at &&
      manifest.run_id === monolithic.run_id,
    referenced_local_artifacts: referencedArtifacts,
    missing_local_artifacts: missingForTerm,
  });
}

const checks = {
  repository_and_production_metadata_timestamp_match:
    repositoryMetadata.last_update === liveMetadata.last_update,
  repository_and_production_term_sets_match: isDeepStrictEqual(
    repositoryTerms,
    liveTerms,
  ),
  live_download_count_is_31: downloadManifest.downloads.length === 31,
  all_live_downloads_returned_200: downloadManifest.downloads.every(
    (entry) => entry.http_status === 200,
  ),
  all_terms_reconstruct_exactly: termResults.every(
    (entry) => entry.list_detail_reconstructs_repository_snapshot,
  ),
  all_term_course_ids_match: termResults.every(
    (entry) => entry.live_list_and_detail_course_ids_match,
  ),
  all_manifests_match_snapshots: termResults.every(
    (entry) => entry.manifest_matches_snapshot,
  ),
  all_manifest_local_artifacts_are_packaged: missingArtifacts.length === 0,
};
const report = {
  validated_at: new Date().toISOString(),
  checks,
  all_pass: Object.values(checks).every(Boolean),
  term_results: termResults,
  missing_artifacts: missingArtifacts,
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.all_pass) process.exitCode = 1;
