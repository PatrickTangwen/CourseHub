import { describe, expect, it } from 'vitest';

import { createPublishedSnapshotResponse } from './publishedSnapshot.response.js';
import type {
  PublishedSnapshotAsset,
  PublishedSnapshotStore,
} from './publishedSnapshot.store.js';

const encoder = new TextEncoder();

function asset(value: unknown, etag: string): PublishedSnapshotAsset {
  const body = encoder.encode(JSON.stringify(value));
  return {
    body: new Blob([body]).stream(),
    contentLength: body.byteLength,
    contentType: 'application/json; charset=utf-8',
    etag,
  };
}

describe('Published Snapshot response', () => {
  it('serves term-scoped Catalog details with cache validators', async () => {
    const details = {
      active_planning_term: 'FA26',
      courses: [
        {
          course_id: 'CSE:100',
          grade_archive_records: [{ year: '25', quarter: 'FA' }],
        },
      ],
    };
    const store: PublishedSnapshotStore = {
      openMetadata: () => Promise.resolve(null),
      openSnapshot: () => Promise.resolve(null),
      openDetails: (term) =>
        Promise.resolve(term === 'FA26' ? asset(details, '"details"') : null),
    };

    const response = await createPublishedSnapshotResponse(
      'GET',
      '/api/catalog/details/FA26',
      new Headers(),
      store,
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get('etag')).toBe('"details"');
    expect(await response?.json()).toEqual(details);

    const notModified = await createPublishedSnapshotResponse(
      'GET',
      '/api/catalog/details/FA26',
      new Headers({ 'if-none-match': '"details"' }),
      store,
    );
    expect(notModified?.status).toBe(304);

    const head = await createPublishedSnapshotResponse(
      'HEAD',
      '/api/catalog/details/FA26',
      new Headers(),
      store,
    );
    expect(head?.status).toBe(200);
    expect(await head?.text()).toBe('');

    expect(
      await createPublishedSnapshotResponse(
        'GET',
        '/api/catalog/details/NOPE',
        new Headers(),
        store,
      ),
    ).toBeNull();
  });
});
