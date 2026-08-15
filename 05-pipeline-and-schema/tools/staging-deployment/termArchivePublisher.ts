import { digest } from './stagingContract.js';
import type { TermArchiveRegistry } from './termArchive.js';

type StoreOptions = {
  cacheControl: string;
  contentType: string;
  metadata?: { [key: string]: string };
  storageClass: 'STANDARD';
};

export interface TermArchiveStore {
  get: (key: string) => Promise<Uint8Array | null>;
  put: (key: string, body: Uint8Array, options: StoreOptions) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

type Archive = {
  registry: TermArchiveRegistry;
  terms: {
    term: string;
    snapshot: { body: Uint8Array; sha256: string };
    details: { body: Uint8Array; sha256: string };
    manifest: { body: Uint8Array; sha256: string };
  }[];
};

const encoder = new TextEncoder();
const registryVerificationBatchSize = 4;

export async function publishTermArchive(
  archive: Archive,
  store: TermArchiveStore,
  reportProgress = (event: string) => console.log(event),
) {
  const report = (phase: string, term?: string) =>
    reportProgress(
      JSON.stringify({
        operation: 'term-archive-publish',
        phase,
        ...(term ? { term } : {}),
      }),
    );
  const previousMetadata = await store.get('metadata.json');

  for (const { term, snapshot, details, manifest } of archive.terms) {
    report('term-start', term);
    await putAndVerify(
      store,
      'Published Snapshot',
      `published-snapshots/${term}/${snapshot.sha256}.json`,
      snapshot,
      {
        cacheControl: 'public, max-age=3600',
        contentType: 'application/json; charset=utf-8',
        metadata: { sha256: snapshot.sha256, term },
        storageClass: 'STANDARD',
      },
    );
    await putAndVerify(
      store,
      'Catalog details',
      `published-details/${term}/${details.sha256}.json`,
      details,
      {
        cacheControl: 'public, max-age=3600',
        contentType: 'application/json; charset=utf-8',
        metadata: { sha256: details.sha256, term },
        storageClass: 'STANDARD',
      },
    );
    await putAndVerify(
      store,
      'Import Manifest',
      `published-manifests/${term}/${manifest.sha256}.json`,
      manifest,
      {
        cacheControl: 'private, no-store',
        contentType: 'application/json; charset=utf-8',
        metadata: { sha256: manifest.sha256, term },
        storageClass: 'STANDARD',
      },
    );
    report('term-complete', term);
  }

  report('registry-verify-start');
  const evidenceTerms = [];
  for (
    let start = 0;
    start < archive.registry.terms.length;
    start += registryVerificationBatchSize
  ) {
    const batch = archive.registry.terms.slice(
      start,
      start + registryVerificationBatchSize,
    );
    const batchEvidence = await Promise.all(
      batch.map(async (entry) => {
        const snapshotDigest = digestFromPath(entry.snapshot_path);
        const detailDigest = entry.detail_path
          ? digestFromPath(entry.detail_path)
          : null;
        const manifestDigest = digestFromPath(entry.manifest_path);
        await verifyExisting(
          store,
          'Published Snapshot',
          entry.snapshot_path,
          snapshotDigest,
        );
        if (entry.detail_path && detailDigest) {
          await verifyExisting(
            store,
            'Catalog details',
            entry.detail_path,
            detailDigest,
          );
        }
        await verifyExisting(
          store,
          'Import Manifest',
          entry.manifest_path,
          manifestDigest,
        );
        return {
          term: entry.term,
          snapshotDigest,
          detailDigest,
          manifestDigest,
        };
      }),
    );
    evidenceTerms.push(...batchEvidence);
  }
  report('registry-verify-complete');

  const metadataBody = encoder.encode(`${JSON.stringify(archive.registry)}\n`);
  const metadataDigest = digest(metadataBody);
  report('metadata-start');
  try {
    await putAndVerify(
      store,
      'Catalog metadata',
      'metadata.json',
      { body: metadataBody, sha256: metadataDigest },
      {
        cacheControl: 'public, max-age=3600',
        contentType: 'application/json; charset=utf-8',
        metadata: { sha256: metadataDigest },
        storageClass: 'STANDARD',
      },
    );
  } catch (error) {
    if (previousMetadata) {
      await store.put('metadata.json', previousMetadata, {
        cacheControl: 'public, max-age=3600',
        contentType: 'application/json; charset=utf-8',
        storageClass: 'STANDARD',
      });
    } else {
      await store.delete('metadata.json');
    }
    throw error;
  }
  report('metadata-complete');

  return {
    metadataDigest,
    terms: evidenceTerms,
  };
}

async function verifyExisting(
  store: TermArchiveStore,
  label: string,
  key: string,
  expectedDigest: string,
) {
  const remote = await store.get(key);
  if (!remote || digest(remote) !== expectedDigest)
    throw new Error(`${label} durable digest mismatch`);
}

function digestFromPath(value: string) {
  const filename = value.split('/').at(-1);
  const result = filename?.replace(/\.json$/u, '');
  if (!result || !/^[a-f\d]{64}$/u.test(result))
    throw new Error('Term Archive object path has no digest');
  return result;
}

async function putAndVerify(
  store: TermArchiveStore,
  label: string,
  key: string,
  artifact: { body: Uint8Array; sha256: string },
  options: StoreOptions,
) {
  if (digest(artifact.body) !== artifact.sha256)
    throw new Error(`${label} local digest mismatch`);
  await store.put(key, artifact.body, options);
  const remote = await store.get(key);
  if (!remote || digest(remote) !== artifact.sha256)
    throw new Error(`${label} remote digest mismatch`);
}
