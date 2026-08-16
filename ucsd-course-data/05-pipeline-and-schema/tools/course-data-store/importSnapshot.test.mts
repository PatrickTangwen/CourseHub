import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { importSnapshot } from './importSnapshot.mjs';

const execFileAsync = promisify(execFile);

describe('Course Data Store Snapshot Importer', () => {
  it('rejects an unknown lifecycle before attempting a database connection', async () => {
    const result = await execFileAsync(
      'bun',
      [
        'tools/course-data-store/importSnapshot.mts',
        'api/static/catalogs/public/S326.json',
        'api/static/catalogs/import-manifests/S326.json',
        '--lifecycle',
        'archived',
      ],
      {
        cwd: path.resolve(import.meta.dirname, '../..'),
        env: {
          ...process.env,
          COURSE_DATA_STORE_DATABASE_URL:
            'postgresql://invalid.invalid/database',
        },
      },
    ).then(
      () => ({ exitCode: 0, stderr: '' }),
      (error: unknown) => {
        const failure = error as { code: number; stderr: string };
        return { exitCode: failure.code, stderr: failure.stderr };
      },
    );

    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stderr)).toMatchObject({
      result: 'rejected',
      reason: 'invalid_lifecycle',
    });
  });

  it('rejects an invalid snapshot before attempting a database connection', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'course-import-'));
    const snapshotPath = path.join(directory, 'invalid.json');
    await writeFile(snapshotPath, JSON.stringify({ courses: [] }));

    await expect(
      importSnapshot(
        snapshotPath,
        'postgresql://invalid.invalid/database',
        'unused-manifest.json',
      ),
    ).rejects.toThrow('Published Snapshot is invalid');
  });

  it('rejects failed core-source cells before first promotion', async () => {
    await expect(
      importSnapshot(
        path.resolve(
          import.meta.dirname,
          '../../api/static/catalogs/public/S326.json',
        ),
        'postgresql://invalid.invalid/database',
        path.resolve(
          import.meta.dirname,
          '../../api/static/catalogs/import-manifests/S326.json',
        ),
      ),
    ).rejects.toThrow('failed or partial core source');

    const result = await execFileAsync(
      'bun',
      [
        'tools/course-data-store/importSnapshot.mts',
        'api/static/catalogs/public/S326.json',
        'api/static/catalogs/import-manifests/S326.json',
      ],
      {
        cwd: path.resolve(import.meta.dirname, '../..'),
        env: {
          ...process.env,
          COURSE_DATA_STORE_DATABASE_URL:
            'postgresql://invalid.invalid/database',
        },
      },
    ).then(
      () => ({ exitCode: 0, stderr: '' }),
      (error: unknown) => {
        const failure = error as { code: number; stderr: string };
        return { exitCode: failure.code, stderr: failure.stderr };
      },
    );
    const report = JSON.parse(result.stderr) as {
      reason: string;
      courses: { rejected: number };
      manifestCells: { rejected: number; identities: { rejected: string[] } };
    };
    expect(result.exitCode).not.toBe(0);
    expect(report.reason).toBe('invalid_core_source');
    expect(report.courses.rejected).toBe(0);
    expect(report.manifestCells.rejected).toBeGreaterThan(0);
    expect(report.manifestCells.identities.rejected).toContain(
      'AIP:schedule_of_classes',
    );
  });

  it('returns bounded rejected counts and a non-zero exit for invalid input', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'course-import-'));
    const snapshotPath = path.join(directory, 'invalid.json');
    await writeFile(snapshotPath, '{');

    const result = await execFileAsync(
      'bun',
      [
        'tools/course-data-store/importSnapshot.mts',
        snapshotPath,
        'unused-manifest.json',
      ],
      {
        cwd: path.resolve(import.meta.dirname, '../..'),
        env: {
          ...process.env,
          COURSE_DATA_STORE_DATABASE_URL:
            'postgresql://invalid.invalid/database',
        },
      },
    ).then(
      () => ({ exitCode: 0, stderr: '' }),
      (error: unknown) => {
        const failure = error as { code: number; stderr: string };
        return { exitCode: failure.code, stderr: failure.stderr };
      },
    );

    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stderr)).toMatchObject({
      result: 'rejected',
      reason: 'invalid_snapshot',
      courses: {
        created: 0,
        updated: 0,
        unchanged: 0,
        removed: 0,
        rejected: 1,
      },
      sections: { rejected: 0 },
      manifestCells: { rejected: 0 },
    });
  });
});
