import {
  attachGradeArchiveRecords,
  buildTracerCatalogSnapshot,
  loadCatalogSnapshotConfig,
  publishCatalogSnapshot,
} from './catalogSnapshot.js';
import { fetchGeneralCatalogForSubjects } from './generalCatalog.js';
import { fetchInstructorGradeArchiveForSubjects } from './instructorGradeArchive.js';

function readConfigPath() {
  const index = process.argv.indexOf('--config');
  if (index === -1) return 'config/catalog-snapshot.ucsd.yaml';
  const value = process.argv[index + 1];
  if (!value) throw new Error('--config requires a path');
  return value;
}

const config = await loadCatalogSnapshotConfig(readConfigPath());
const generalCatalogCourses = await fetchGeneralCatalogForSubjects(
  config.configured_subjects,
);
const baseSnapshot = buildTracerCatalogSnapshot(config, {
  generalCatalogCourses,
});
const gradeArchiveRecords = await fetchInstructorGradeArchiveForSubjects(
  config.configured_subjects,
);
const snapshot = attachGradeArchiveRecords(
  {
    ...baseSnapshot,
    source_timestamps: {
      ...baseSnapshot.source_timestamps,
      general_catalog: baseSnapshot.generated_at,
      instructor_grade_archive: baseSnapshot.generated_at,
    },
  },
  gradeArchiveRecords,
);
const result = await publishCatalogSnapshot(snapshot, config);

console.log(
  JSON.stringify(
    {
      run_id: snapshot.run_id,
      active_planning_term: snapshot.active_planning_term,
      snapshot_path: result.snapshotPath,
      metadata_path: result.metadataPath,
    },
    null,
    2,
  ),
);
