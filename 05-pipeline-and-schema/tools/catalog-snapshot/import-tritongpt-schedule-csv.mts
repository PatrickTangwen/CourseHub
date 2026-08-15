import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  convertTritonGptCsvChunks,
  tritonGptPackageIdentity,
  tritonGptSectionCodePackageIdentity,
} from './tritonGptScheduleCsv.js';

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function requiredArgument(name: string) {
  const value = argument(name);
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

async function existingFile(file: string) {
  try {
    await access(file);
    return file;
  } catch {
    return undefined;
  }
}

async function readJson(file: string) {
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null;
}

function configuredSubjects(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.configured_subjects)) {
    throw new Error(
      'Expected-subjects source has no configured_subjects array',
    );
  }
  if (value.configured_subjects.some((subject) => typeof subject !== 'string'))
    throw new Error('configured_subjects must contain only strings');
  return value.configured_subjects as string[];
}

function stablePackageIdsFromSnapshot(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.active_planning_term !== 'string' ||
    !Array.isArray(value.courses)
  )
    throw new Error('Previous snapshot has an unexpected shape');

  const ids: { [packageIdentity: string]: string } = {};
  const termPrefix = `${value.active_planning_term}:`;
  for (const courseValue of value.courses) {
    if (!isRecord(courseValue) || !Array.isArray(courseValue.sections))
      continue;
    for (const sectionValue of courseValue.sections) {
      if (
        !isRecord(sectionValue) ||
        typeof sectionValue.section_id !== 'string' ||
        !sectionValue.section_id.startsWith(termPrefix) ||
        !isRecord(sectionValue.raw)
      )
        continue;
      const { raw } = sectionValue;
      const packageId = sectionValue.section_id.slice(termPrefix.length);
      if (typeof raw.tss_course_code !== 'string') continue;
      const identities: string[] = [];
      if (
        Array.isArray(raw.tss_event_ids) &&
        raw.tss_event_ids.every((eventId) => typeof eventId === 'string')
      ) {
        identities.push(
          tritonGptPackageIdentity(raw.tss_course_code, raw.tss_event_ids),
        );
      }
      if (typeof sectionValue.section_code === 'string') {
        identities.push(
          tritonGptSectionCodePackageIdentity(
            raw.tss_course_code,
            sectionValue.section_code.split(/ \+ /u),
          ),
        );
      }
      for (const identity of identities) {
        const existing = ids[identity];
        if (existing && existing !== packageId) {
          throw new Error(
            `Previous snapshot has conflicting ids for ${identity}: ${existing}, ${packageId}`,
          );
        }
        ids[identity] = packageId;
      }
    }
  }
  return ids;
}

type InputChunk = { file: string; content: string };

const csvDirectory = argument('--csv-dir');
const transferPath = argument('--transfer-json');
if (Boolean(csvDirectory) === Boolean(transferPath))
  throw new Error('Provide exactly one of --csv-dir or --transfer-json');

const outputDirectory = requiredArgument('--output-dir');
const rawDirectory = argument('--raw-dir') ?? csvDirectory;
if (!rawDirectory)
  throw new Error('--raw-dir is required with --transfer-json');

const existingManifestFile = csvDirectory
  ? await existingFile(path.join(csvDirectory, 'manifest.json'))
  : undefined;
const existingManifest = existingManifestFile
  ? await readJson(existingManifestFile)
  : undefined;
const existingProvenance = isRecord(existingManifest) ? existingManifest : {};
let sourceUrl =
  argument('--source-url') ??
  (typeof existingProvenance.source_url === 'string'
    ? existingProvenance.source_url
    : null);
let chatId =
  argument('--chat-id') ??
  (typeof existingProvenance.chat_id === 'string'
    ? existingProvenance.chat_id
    : null);
let provenanceCapturedAt =
  typeof existingProvenance.captured_at === 'string'
    ? existingProvenance.captured_at
    : undefined;
const inputChunks: InputChunk[] = await (async () => {
  if (csvDirectory) {
    const entries = await readdir(csvDirectory, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.csv'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, 'en-US', { numeric: true }));
    if (files.length === 0)
      throw new Error(`No CSV files found in ${csvDirectory}`);
    return Promise.all(
      files.map(async (file) => ({
        file,
        content: await readFile(path.join(csvDirectory, file), 'utf8'),
      })),
    );
  }

  const transferValue = await readJson(transferPath!);
  if (!isRecord(transferValue))
    throw new Error('Transfer JSON must contain an object');
  const transfer = transferValue as {
    source_url?: unknown;
    chat_id?: unknown;
    captured_at?: unknown;
    chunks?: unknown;
  };
  if (
    !Array.isArray(transfer.chunks) ||
    transfer.chunks.some((chunk) => typeof chunk !== 'string')
  )
    throw new Error('Transfer JSON must contain a string chunks array');
  if (!sourceUrl && typeof transfer.source_url === 'string')
    sourceUrl = transfer.source_url;
  if (!chatId && typeof transfer.chat_id === 'string')
    chatId = transfer.chat_id;
  if (typeof transfer.captured_at === 'string')
    provenanceCapturedAt = transfer.captured_at;
  const { chunks: transferChunks } = transfer;
  return (transferChunks as string[]).map((content, index) => ({
    file: `chunk-${String(index + 1).padStart(3, '0')}.csv`,
    content,
  }));
})();

const capturedAt = argument('--captured-at') ?? provenanceCapturedAt;
if (!capturedAt) {
  throw new Error(
    '--captured-at is required unless the CSV manifest or transfer JSON provides it',
  );
}

const chunks = inputChunks.map(({ content }) => content);
const preliminary = convertTritonGptCsvChunks(chunks, { capturedAt });
const { term } = preliminary.response;

const disablePreviousSnapshot = hasFlag('--no-previous-snapshot');
const explicitPreviousSnapshot = argument('--previous-snapshot');
if (disablePreviousSnapshot && explicitPreviousSnapshot) {
  throw new Error(
    '--no-previous-snapshot cannot be combined with --previous-snapshot',
  );
}
const automaticPreviousSnapshot = path.join(
  'api/static/catalogs/public',
  `${term}.json`,
);
const previousSnapshotFile = disablePreviousSnapshot
  ? undefined
  : (explicitPreviousSnapshot ??
    (await existingFile(automaticPreviousSnapshot)));
const previousSnapshot = previousSnapshotFile
  ? await readJson(previousSnapshotFile)
  : undefined;

const expectedSubjectsFile = argument('--expected-subjects-file');
if (!expectedSubjectsFile && !previousSnapshot) {
  throw new Error(
    'A previous snapshot or --expected-subjects-file is required to establish truthful subject coverage',
  );
}
const expectedSubjects = expectedSubjectsFile
  ? configuredSubjects(await readJson(expectedSubjectsFile))
  : previousSnapshot
    ? configuredSubjects(previousSnapshot)
    : undefined;
const stablePackageIds = previousSnapshot
  ? stablePackageIdsFromSnapshot(previousSnapshot)
  : {};

await Promise.all([
  mkdir(rawDirectory, { recursive: true }),
  mkdir(outputDirectory, { recursive: true }),
  mkdir(path.join(outputDirectory, 'reports'), { recursive: true }),
]);
const chunkManifest = [];
for (const [index, chunk] of inputChunks.entries()) {
  await writeFile(path.join(rawDirectory, chunk.file), chunk.content);
  chunkManifest.push({
    index: index + 1,
    file: chunk.file,
    bytes: Buffer.byteLength(chunk.content),
    lines: chunk.content.split(/\r?\n/u).length,
    sha256: createHash('sha256').update(chunk.content).digest('hex'),
  });
}
await writeFile(
  path.join(rawDirectory, 'manifest.json'),
  `${JSON.stringify(
    {
      source_url: sourceUrl,
      chat_id: chatId,
      captured_at: capturedAt,
      input_mode: csvDirectory ? 'csv_directory' : 'transfer_json',
      term,
      previous_snapshot: previousSnapshotFile ?? null,
      chunk_count: chunks.length,
      chunks: chunkManifest,
    },
    null,
    2,
  )}\n`,
);

const converted = convertTritonGptCsvChunks(chunks, {
  capturedAt,
  expectedSubjects,
  stablePackageIds,
});
const responsePath = path.join(outputDirectory, 'schedule.json');
const reportPath = path.join(
  outputDirectory,
  'reports',
  'conversion-report.json',
);
await Promise.all([
  writeFile(responsePath, `${JSON.stringify(converted.response, null, 2)}\n`),
  writeFile(reportPath, `${JSON.stringify(converted.report, null, 2)}\n`),
]);
console.log(
  JSON.stringify(
    {
      input_mode: csvDirectory ? 'csv_directory' : 'transfer_json',
      term,
      previous_snapshot: previousSnapshotFile ?? null,
      raw_directory: rawDirectory,
      response_path: responsePath,
      report_path: reportPath,
      ...converted.report,
    },
    null,
    2,
  ),
);
