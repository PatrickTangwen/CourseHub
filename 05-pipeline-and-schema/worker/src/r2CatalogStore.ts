import type { CatalogPublicationStore } from './catalogPublication.js';
import type { PublishedSnapshotStore } from '../../api/src/catalog/publishedSnapshot.store.js';

export interface R2CatalogObject {
  body: ReadableStream<Uint8Array>;
  httpEtag: string;
  size: number;
  uploaded: Date;
  writeHttpMetadata: (headers: Headers) => void;
}

export interface R2CatalogBucket {
  get: (key: string) => Promise<R2CatalogObject | null>;
  put: (
    key: string,
    body: Uint8Array,
    options?: {
      customMetadata?: { [key: string]: string };
      httpMetadata?: { contentType?: string; cacheControl?: string };
    },
  ) => Promise<unknown>;
}

export function createR2PublishedSnapshotStore(
  bucket: R2CatalogBucket,
): PublishedSnapshotStore {
  async function openCatalogAsset(
    term: string,
    field: 'snapshot_path' | 'detail_path',
    prefix: string,
  ) {
    const metadata = await bucket.get('metadata.json');
    if (!metadata) return null;
    const registry: unknown = JSON.parse(
      await new Response(metadata.body).text(),
    ) as unknown;
    const key = pathForTerm(registry, term, field);
    if (!key || !isCatalogKeyForTerm(key, term, prefix)) return null;
    return toAsset(await bucket.get(key));
  }

  return {
    openMetadata: async () => toAsset(await bucket.get('metadata.json')),
    openSnapshot: (term) =>
      openCatalogAsset(term, 'snapshot_path', 'published-snapshots'),
    openDetails: (term) =>
      openCatalogAsset(term, 'detail_path', 'published-details'),
  };
}

function pathForTerm(
  registry: unknown,
  term: string,
  field: 'snapshot_path' | 'detail_path',
) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry))
    return null;
  const { terms } = registry as { terms?: unknown };
  if (!Array.isArray(terms)) return null;
  for (const entry of terms) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const candidate = entry as {
      term?: unknown;
      snapshot_path?: unknown;
      detail_path?: unknown;
    };
    if (candidate.term === term && typeof candidate[field] === 'string')
      return candidate[field];
  }
  return null;
}

export function createR2CatalogPublicationStore(
  bucket: R2CatalogBucket,
): CatalogPublicationStore {
  return {
    async putObject(key, body, options) {
      await bucket.put(key, body, {
        customMetadata: options.customMetadata,
        httpMetadata: {
          contentType: options.contentType,
          cacheControl: options.cacheControl,
        },
      });
    },
  };
}

function toAsset(object: R2CatalogObject | null) {
  if (!object) return null;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  return {
    body: object.body,
    cacheControl: headers.get('cache-control') ?? undefined,
    contentLength: object.size,
    contentType: headers.get('content-type') ?? undefined,
    etag: object.httpEtag,
    lastModified: object.uploaded,
  };
}

function isCatalogKeyForTerm(key: string, term: string, prefix: string) {
  return (
    key.startsWith(`${prefix}/${term}/`) &&
    key.endsWith('.json') &&
    !key.includes('..')
  );
}
