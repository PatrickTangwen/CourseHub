import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createFilesystemPublishedSnapshotStore } from './publishedSnapshot.filesystem.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('filesystem Published Snapshot store', () => {
  it('derives and caches separate list and detail assets from the canonical snapshot', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'catalog-payload-'));
    directories.push(root);
    const publicDirectory = path.join(root, 'catalogs', 'public');
    await mkdir(publicDirectory, { recursive: true });
    await writeFile(
      path.join(publicDirectory, 'FA26.json'),
      JSON.stringify({
        run_id: 'run-filesystem-split',
        generated_at: '2026-07-22T12:00:00.000Z',
        active_planning_term: 'FA26',
        courses: [
          {
            course_id: 'CSE:100',
            title: 'Advanced Data Structures',
            grade_archive_records: [{ year: '25', quarter: 'FA' }],
          },
        ],
      }),
    );
    const store = createFilesystemPublishedSnapshotStore(root);

    const list = await store.openSnapshot('FA26');
    const details = await store.openDetails('FA26');

    expect(await new Response(list?.body).json()).toEqual({
      run_id: 'run-filesystem-split',
      generated_at: '2026-07-22T12:00:00.000Z',
      active_planning_term: 'FA26',
      courses: [
        {
          course_id: 'CSE:100',
          title: 'Advanced Data Structures',
        },
      ],
    });
    expect(await new Response(details?.body).json()).toEqual({
      run_id: 'run-filesystem-split',
      generated_at: '2026-07-22T12:00:00.000Z',
      active_planning_term: 'FA26',
      courses: [
        {
          course_id: 'CSE:100',
          grade_archive_records: [{ year: '25', quarter: 'FA' }],
        },
      ],
    });
    expect(list?.etag).toBeTruthy();
    expect(details?.etag).toBeTruthy();
    expect(list?.etag).not.toBe(details?.etag);
  });
});
