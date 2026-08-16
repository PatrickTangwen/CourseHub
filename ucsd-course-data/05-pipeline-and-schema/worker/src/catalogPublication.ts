import {
  encodeCatalogPayload,
  splitPublishedCatalogPayload,
} from '../../shared/catalogPayload.js';

export interface CatalogPublicationStore {
  putObject: (
    key: string,
    body: Uint8Array,
    options: {
      contentType: string;
      cacheControl: string;
      customMetadata: { [key: string]: string };
    },
  ) => Promise<void>;
}

interface AcceptedArtifact {
  body: Uint8Array;
  size: number;
  sha256: string;
}

export interface AcceptedCatalogPublication {
  accepted: true;
  term: string;
  snapshot: AcceptedArtifact;
  manifest: AcceptedArtifact;
  registry: Uint8Array;
}

interface SupportedTermRegistry {
  last_update: string;
  terms: {
    term: string;
    label: string;
    date_range: { start: string; end: string } | null;
    frozen: boolean;
    generated_at: string;
    snapshot_path: string;
    detail_path: string | null;
    manifest_path: string | null;
  }[];
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export async function publishAcceptedCatalog(
  publication: AcceptedCatalogPublication,
  store: CatalogPublicationStore,
) {
  if ((publication as { accepted?: boolean }).accepted !== true)
    throw new Error('Import Manifest is not accepted');
  if (!isSupportedTermKey(publication.term))
    throw new Error('Published Snapshot term is invalid');
  await validateArtifact('Published Snapshot', publication.snapshot);
  await validateArtifact('Import Manifest', publication.manifest);
  const snapshot = parseArtifact('Published Snapshot', publication.snapshot);
  const manifest = parseArtifact('Import Manifest', publication.manifest);
  assertArtifactTerm('Published Snapshot', snapshot, publication.term);
  assertArtifactTerm('Import Manifest', manifest, publication.term);
  validateImportManifest(manifest, publication.term);
  const registry = parseSupportedTermRegistry(publication.registry);
  const entry = registry.terms.find(({ term }) => term === publication.term);
  if (!entry)
    throw new Error(`Unsupported Published Snapshot term: ${publication.term}`);
  const { listPayload, detailPayload } = splitPublishedCatalogPayload(snapshot);
  const listArtifact = await jsonArtifact(listPayload);
  const detailArtifact = await jsonArtifact(detailPayload);

  const snapshotKey = `published-snapshots/${publication.term}/${listArtifact.sha256}.json`;
  const detailKey = `published-details/${publication.term}/${detailArtifact.sha256}.json`;
  const manifestKey = `published-manifests/${publication.term}/${publication.manifest.sha256}.json`;
  const metadata = encoder.encode(
    `${JSON.stringify({
      ...registry,
      terms: registry.terms.map((termEntry) =>
        termEntry.term === publication.term
          ? {
              ...termEntry,
              snapshot_path: snapshotKey,
              detail_path: detailKey,
              manifest_path: manifestKey,
            }
          : termEntry,
      ),
    })}\n`,
  );

  await store.putObject(snapshotKey, listArtifact.body, {
    contentType: 'application/json; charset=utf-8',
    cacheControl: 'public, max-age=3600',
    customMetadata: { sha256: listArtifact.sha256 },
  });
  await store.putObject(detailKey, detailArtifact.body, {
    contentType: 'application/json; charset=utf-8',
    cacheControl: 'public, max-age=3600',
    customMetadata: { sha256: detailArtifact.sha256 },
  });
  await store.putObject(manifestKey, publication.manifest.body, {
    contentType: 'application/json; charset=utf-8',
    cacheControl: 'private, no-store',
    customMetadata: { sha256: publication.manifest.sha256 },
  });
  await store.putObject('metadata.json', metadata, {
    contentType: 'application/json; charset=utf-8',
    cacheControl: 'public, max-age=3600',
    customMetadata: { term: publication.term },
  });

  return { snapshotKey, detailKey, manifestKey };
}

async function validateArtifact(label: string, artifact: AcceptedArtifact) {
  if (artifact.body.byteLength !== artifact.size)
    throw new Error(`${label} size mismatch`);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(artifact.body).buffer,
  );
  const actual = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (actual !== artifact.sha256) throw new Error(`${label} digest mismatch`);
}

async function jsonArtifact(value: unknown): Promise<AcceptedArtifact> {
  const body = encodeCatalogPayload(value);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(body).buffer,
  );
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return { body, size: body.byteLength, sha256 };
}

function parseArtifact(label: string, artifact: AcceptedArtifact) {
  try {
    const parsed = JSON.parse(decoder.decode(artifact.body)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('expected an object');
    return parsed as { [key: string]: unknown };
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function assertArtifactTerm(
  label: string,
  parsed: { [key: string]: unknown },
  term: string,
) {
  if (parsed.active_planning_term !== term)
    throw new Error(`${label} term mismatch`);
}

function validateImportManifest(
  manifest: { [key: string]: unknown },
  term: string,
) {
  if (!Array.isArray(manifest.cells))
    throw new Error('Import Manifest cells are invalid');
  if (manifest.cells.some((cell) => !isRecord(cell)))
    throw new Error('Import Manifest cells are invalid');
  const cells = manifest.cells as { [key: string]: unknown }[];
  const { summary } = manifest;
  if (!isRecord(summary)) throw new Error('Import Manifest summary is invalid');

  const statuses = ['ok', 'empty', 'failed', 'partial'] as const;
  const allowedStatuses = new Set<string>(statuses);
  if (cells.some((cell) => !allowedStatuses.has(String(cell.status))))
    throw new Error('Import Manifest cell status is invalid');
  for (const status of statuses) {
    const count = cells.filter((cell) => cell.status === status).length;
    if (summary[status] !== count)
      throw new Error('Import Manifest summary does not match cells');
  }
  if (cells.some((cell) => cell.term !== term))
    throw new Error('Import Manifest cell term mismatch');
}

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseSupportedTermRegistry(body: Uint8Array): SupportedTermRegistry {
  const parsed = JSON.parse(decoder.decode(body)) as unknown;
  if (!isRecord(parsed) || typeof parsed.last_update !== 'string')
    throw new Error('Supported Term registry is invalid');
  if (!Array.isArray(parsed.terms))
    throw new Error('Supported Term registry terms are invalid');

  return {
    last_update: parsed.last_update,
    terms: parsed.terms.map((entry) => normalizeSupportedTerm(entry)),
  };
}

function normalizeSupportedTerm(
  value: unknown,
): SupportedTermRegistry['terms'][number] {
  if (!isRecord(value)) throw new Error('Supported Term entry is invalid');
  const dateRange = normalizeDateRange(value.date_range);
  if (
    typeof value.term !== 'string' ||
    !isSupportedTermKey(value.term) ||
    typeof value.label !== 'string' ||
    typeof value.frozen !== 'boolean' ||
    typeof value.generated_at !== 'string' ||
    !isPrivateObjectPath(value.snapshot_path) ||
    (value.detail_path !== undefined &&
      value.detail_path !== null &&
      !isPrivateObjectPath(value.detail_path)) ||
    (value.manifest_path !== null && !isPrivateObjectPath(value.manifest_path))
  )
    throw new Error('Supported Term entry is invalid');

  return {
    term: value.term,
    label: value.label,
    date_range: dateRange,
    frozen: value.frozen,
    generated_at: value.generated_at,
    snapshot_path: value.snapshot_path,
    detail_path:
      typeof value.detail_path === 'string' ? value.detail_path : null,
    manifest_path: value.manifest_path,
  };
}

function normalizeDateRange(
  value: unknown,
): { start: string; end: string } | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    typeof value.start !== 'string' ||
    typeof value.end !== 'string'
  )
    throw new Error('Supported Term date range is invalid');
  return { start: value.start, end: value.end };
}

function isPrivateObjectPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[\w./-]+$/u.test(value) &&
    !value.startsWith('/') &&
    !value.split('/').includes('..')
  );
}

function isSupportedTermKey(value: string) {
  return /^[\w-]+$/u.test(value);
}
