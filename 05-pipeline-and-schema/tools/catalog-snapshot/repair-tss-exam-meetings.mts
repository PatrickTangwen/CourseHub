import {
  mkdtemp,
  readFile,
  rename,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import {
  assertRawTssResponse,
  parseTssExamMeetings,
  repairTssExamMeetings,
} from './tssExamMeetingRepair.js';

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const result = process.argv[index + 1];
  if (index < 0 || !result) throw new Error(`${name} requires a value`);
  return result;
}

async function writeJsonAtomically(
  path: string,
  value: unknown,
): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(dirname(path), '.tss-repair-'));
  const temporaryPath = join(temporaryDirectory, basename(path));
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  } finally {
    await rmdir(temporaryDirectory);
  }
}

try {
  const sourcePath = argument('--source');
  const rawPath = argument('--raw');
  const sourceText = await readFile(sourcePath, 'utf8');
  const response: unknown = JSON.parse(await readFile(rawPath, 'utf8'));
  assertRawTssResponse(response);
  const exams = parseTssExamMeetings(sourceText);
  if (exams.length === 0) throw new Error('Source contains no exam meetings');
  const result = repairTssExamMeetings(response, exams);
  await writeJsonAtomically(rawPath, response);
  console.log(
    JSON.stringify(
      {
        source_path: sourcePath,
        raw_path: rawPath,
        source_exam_meetings: exams.length,
        repaired_components: result.repairedComponents,
        replaced_meetings: result.replacedMeetings,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
