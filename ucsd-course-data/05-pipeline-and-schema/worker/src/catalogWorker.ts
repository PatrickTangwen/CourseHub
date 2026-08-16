import {
  createR2PublishedSnapshotStore,
  type R2CatalogBucket,
} from './r2CatalogStore.js';
import { createPublishedSnapshotResponse } from '../../api/src/catalog/publishedSnapshot.response.js';

export interface CatalogWorkerEnv {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  CATALOG_BUCKET: R2Bucket;
}

export interface CatalogWorkerRequestOptions {
  onR2Read?: () => void;
}

export async function handleCatalogWorkerRequest(
  request: Request,
  environment: CatalogWorkerEnv,
  options: CatalogWorkerRequestOptions = {},
) {
  const url = new URL(request.url);
  const { onR2Read } = options;
  const bucket: R2CatalogBucket = environment.CATALOG_BUCKET;
  const observedBucket: R2CatalogBucket = onR2Read
    ? {
        get(key) {
          onR2Read();
          return bucket.get(key);
        },
        put: (key, body, putOptions) => bucket.put(key, body, putOptions),
      }
    : bucket;
  try {
    const catalogResponse = await createPublishedSnapshotResponse(
      request.method,
      url.pathname,
      request.headers,
      createR2PublishedSnapshotStore(observedBucket),
    );
    if (catalogResponse) return catalogResponse;
  } catch {
    return Response.json(
      {
        error: 'CATALOG_UNAVAILABLE',
        message: 'Catalog data is temporarily unavailable.',
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  if (
    url.pathname === '/api' ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/ferry' ||
    url.pathname.startsWith('/ferry/')
  ) {
    return Response.json(
      { error: 'NOT_FOUND' },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    );
  }

  return environment.ASSETS.fetch(request);
}

export default {
  fetch: (request, environment) =>
    handleCatalogWorkerRequest(request, environment),
} satisfies ExportedHandler<CatalogWorkerEnv>;
