import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const header =
  'term_code,subject_code,course_code,class_name,course_title,academic_level,section_id,section_ref,section_code,instruction_type_name,instructors_text,seats_available,waitlist_available,meeting_kind,day_code,day_name,specific_date,start_time_display,end_time_display,building_code,room_code,is_remote,is_tba';
const run = promisify(execFile);

describe('TritonGPT CSV importer CLI', () => {
  it('imports a naturally sorted CSV directory without transfer JSON', async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), 'sungrid-tritongpt-csv-'),
    );
    const inputDirectory = path.join(temporaryRoot, 'raw');
    const outputDirectory = path.join(temporaryRoot, 'processed');
    const expectedSubjectsFile = path.join(
      temporaryRoot,
      'expected-subjects.json',
    );
    await mkdir(inputDirectory);
    const firstRow =
      'FA26,CSE,100,CSE 100,Advanced Data Structures,UD,E 1,FA26:E 1,001-000-LE,lecture,Paul Cao,100,,class,M,Monday,,9:00am,9:50am,JEANN,JEANN AUD,0,0';
    const secondRow =
      'FA26,CSE,100,CSE 100,Advanced Data Structures,UD,E 2,FA26:E 2,001-001-DI,discussion,Paul Cao,100,,class,M,Monday,,5:00pm,5:50pm,GH,GH 242,0,0';
    await Promise.all([
      writeFile(
        path.join(inputDirectory, 'chunk-010.csv'),
        `${header}\n${secondRow}\n`,
      ),
      writeFile(
        path.join(inputDirectory, 'chunk-002.csv'),
        `${header}\n${firstRow}\n`,
      ),
      writeFile(
        expectedSubjectsFile,
        `${JSON.stringify({ configured_subjects: ['CSE'] })}\n`,
      ),
      writeFile(
        path.join(inputDirectory, 'manifest.json'),
        `${JSON.stringify({
          source_url: 'https://tritongpt.ucsd.edu/app?chatId=test',
          chat_id: 'test',
          captured_at: '2026-07-22T00:00:00.000Z',
        })}\n`,
      ),
    ]);

    const result = await run(
      'bun',
      [
        'tools/catalog-snapshot/import-tritongpt-schedule-csv.mts',
        '--csv-dir',
        inputDirectory,
        '--output-dir',
        outputDirectory,
        '--no-previous-snapshot',
        '--expected-subjects-file',
        expectedSubjectsFile,
      ],
      { cwd: process.cwd() },
    );
    expect(result.stderr).toBe('');

    const manifest = JSON.parse(
      await readFile(path.join(inputDirectory, 'manifest.json'), 'utf8'),
    ) as {
      input_mode: string;
      term: string;
      previous_snapshot: string | null;
      chunk_count: number;
      chunks: { file: string }[];
      source_url: string | null;
      chat_id: string | null;
      captured_at: string;
    };
    expect(manifest).toMatchObject({
      input_mode: 'csv_directory',
      term: 'FA26',
      previous_snapshot: null,
      chunk_count: 2,
      chunks: [{ file: 'chunk-002.csv' }, { file: 'chunk-010.csv' }],
      source_url: 'https://tritongpt.ucsd.edu/app?chatId=test',
      chat_id: 'test',
      captured_at: '2026-07-22T00:00:00.000Z',
    });
    const schedule = JSON.parse(
      await readFile(path.join(outputDirectory, 'schedule.json'), 'utf8'),
    ) as {
      courses: { booking_choices: { components: { event_id: string }[] }[] }[];
    };
    const [course] = schedule.courses;
    if (!course) throw new Error('Expected one imported course');
    expect(course.booking_choices).toEqual([
      expect.objectContaining({
        components: [
          expect.objectContaining({ event_id: 'E 1' }),
          expect.objectContaining({ event_id: 'E 2' }),
        ],
      }),
    ]);
  });

  it('rejects CSV input without truthful capture provenance', async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), 'sungrid-tritongpt-no-capture-'),
    );
    const inputDirectory = path.join(temporaryRoot, 'raw');
    const outputDirectory = path.join(temporaryRoot, 'processed');
    const expectedSubjectsFile = path.join(
      temporaryRoot,
      'expected-subjects.json',
    );
    await mkdir(inputDirectory);
    await Promise.all([
      writeFile(
        path.join(inputDirectory, 'chunk.csv'),
        `${header}\nFA26,CSE,100,CSE 100,Advanced Data Structures,UD,E 1,FA26:E 1,001-000-LE,lecture,Paul Cao,100,,class,M,Monday,,9:00am,9:50am,JEANN,JEANN AUD,0,0\n`,
      ),
      writeFile(
        expectedSubjectsFile,
        `${JSON.stringify({ configured_subjects: ['CSE'] })}\n`,
      ),
    ]);

    const rejection: unknown = await run(
      'bun',
      [
        'tools/catalog-snapshot/import-tritongpt-schedule-csv.mts',
        '--csv-dir',
        inputDirectory,
        '--output-dir',
        outputDirectory,
        '--no-previous-snapshot',
        '--expected-subjects-file',
        expectedSubjectsFile,
      ],
      { cwd: process.cwd() },
    ).catch((cause: unknown) => cause);
    const stderr =
      rejection instanceof Error && Object.hasOwn(rejection, 'stderr')
        ? (rejection as Error & { stderr?: unknown }).stderr
        : undefined;
    if (typeof stderr !== 'string')
      throw new Error('Expected importer failure with string stderr');
    expect(stderr).toContain('--captured-at is required');
  });
});
