import type {
  PublishedSnapshotAsset,
  PublishedSnapshotStore,
} from './publishedSnapshot.store.js';

interface MemoryPublishedSnapshotInput {
  metadata: string;
  snapshots: { [key: string]: string };
  details?: { [key: string]: string };
}

function createAsset(content: string): PublishedSnapshotAsset {
  const bytes = new TextEncoder().encode(content);
  return {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    cacheControl: 'public, max-age=3600',
    contentLength: bytes.byteLength,
    contentType: 'application/json; charset=utf-8',
  };
}

export function createMemoryPublishedSnapshotStore({
  metadata,
  snapshots,
  details = {},
}: MemoryPublishedSnapshotInput): PublishedSnapshotStore {
  return {
    openMetadata: () => Promise.resolve(createAsset(metadata)),
    openSnapshot: (term) =>
      Promise.resolve(
        Object.hasOwn(snapshots, term) ? createAsset(snapshots[term]!) : null,
      ),
    openDetails: (term) =>
      Promise.resolve(
        Object.hasOwn(details, term) ? createAsset(details[term]!) : null,
      ),
  };
}
