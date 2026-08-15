import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  applyModuleCapacitiesByOrderedSectionEvidence,
  parseModuleCapacityCsv,
} from './tssCapacityHierarchy.js';

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requiredArgument(name: string) {
  const value = argument(name);
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

const schedulePath = requiredArgument('--schedule');
const capacityPath = requiredArgument('--capacity-csv');
const outputDirectory = requiredArgument('--output-dir');
const sourceUrl = requiredArgument('--source-url');
const lastFullRefreshAt = requiredArgument('--last-full-refresh-at');
const [scheduleContents, capacityContents] = await Promise.all([
  readFile(schedulePath, 'utf8'),
  readFile(capacityPath, 'utf8'),
]);
const capacityRows = parseModuleCapacityCsv(capacityContents);
const archivedCapacityPath = path.join(
  outputDirectory,
  'sources',
  'module-capacity.csv',
);
const capacitySource = {
  source_url: sourceUrl,
  last_full_refresh_at: lastFullRefreshAt,
  archived_path: archivedCapacityPath,
  sha256: createHash('sha256').update(capacityContents).digest('hex'),
  bytes: Buffer.byteLength(capacityContents),
  rows: capacityRows.length,
};
const result = applyModuleCapacitiesByOrderedSectionEvidence(
  JSON.parse(scheduleContents) as unknown,
  capacityRows,
);
await Promise.all([
  mkdir(path.join(outputDirectory, 'reports'), { recursive: true }),
  mkdir(path.join(outputDirectory, 'sources'), { recursive: true }),
]);
const responsePath = path.join(outputDirectory, 'schedule.json');
const reportPath = path.join(
  outputDirectory,
  'reports',
  'capacity-hierarchy-report.json',
);
await Promise.all([
  writeFile(
    responsePath,
    `${JSON.stringify(
      { ...result.response, capacity_provenance: capacitySource },
      null,
      2,
    )}\n`,
  ),
  writeFile(
    reportPath,
    `${JSON.stringify(
      { capacity_source: capacitySource, ...result.report },
      null,
      2,
    )}\n`,
  ),
  writeFile(archivedCapacityPath, capacityContents),
]);
console.log(
  JSON.stringify(
    { response_path: responsePath, report_path: reportPath, ...result.report },
    null,
    2,
  ),
);
