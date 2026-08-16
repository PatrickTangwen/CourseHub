import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { isObject } from './stagingContract.js';
import {
  encodeCatalogPayload,
  splitPublishedCatalogPayload,
} from '../../shared/catalogPayload.js';

type Artifact = {
  body: Uint8Array;
  path: string;
  sha256: string;
  size: number;
};

export type TermArchiveRegistryEntry = {
  term: string;
  label: string;
  date_range: { start: string; end: string } | null;
  frozen: boolean;
  generated_at: string;
  snapshot_path: string;
  detail_path: string | null;
  manifest_path: string;
};

const defaultRoot = path.resolve(process.cwd());
const decoder = new TextDecoder();

export type TermArchiveRegistry = {
  last_update: string;
  terms: TermArchiveRegistryEntry[];
};

export async function buildTermArchive(
  root = defaultRoot,
  priorRegistryValue: unknown = null,
) {
  const staticDirectory = path.join(root, 'api/static');
  const snapshotDirectory = path.join(staticDirectory, 'catalogs/public');
  const manifestDirectory = path.join(
    staticDirectory,
    'catalogs/import-manifests',
  );
  const metadata = parseObject(
    'Catalog metadata',
    await readFile(path.join(staticDirectory, 'metadata.json')),
  );
  if (typeof metadata.last_update !== 'string')
    throw new Error('Catalog metadata last_update is invalid');

  const snapshotTerms = await jsonTerms(snapshotDirectory);
  const manifestTerms = await jsonTerms(manifestDirectory);
  if (snapshotTerms.join('\n') !== manifestTerms.join('\n'))
    throw new Error('Published Snapshot and Import Manifest terms differ');

  const priorRegistry = parsePriorRegistry(priorRegistryValue);
  const priorByTerm = new Map(
    priorRegistry?.terms.map((entry) => [entry.term, entry] as const) ?? [],
  );

  const terms = await Promise.all(
    snapshotTerms.map(async (term) => {
      if (priorByTerm.get(term)?.frozen) return null;
      const canonicalSnapshotPath = path.join(
        snapshotDirectory,
        `${term}.json`,
      );
      const canonicalSnapshotBody = await readFile(canonicalSnapshotPath);
      const manifest = await artifact(
        path.join(manifestDirectory, `${term}.json`),
        root,
      );
      const snapshotJson = parseObject(
        'Published Snapshot',
        canonicalSnapshotBody,
      );
      const manifestJson = parseObject('Import Manifest', manifest.body);
      assertTerm('Published Snapshot', snapshotJson, term);
      assertTerm('Import Manifest', manifestJson, term);
      assertAcceptedManifest(manifestJson, term);
      if (
        typeof snapshotJson.term_label !== 'string' ||
        typeof snapshotJson.generated_at !== 'string'
      )
        throw new Error(`Published Snapshot identity is invalid for ${term}`);
      const { listPayload, detailPayload } =
        splitPublishedCatalogPayload(snapshotJson);
      const snapshot = jsonArtifact(
        listPayload,
        path.relative(root, canonicalSnapshotPath),
      );
      const details = jsonArtifact(
        detailPayload,
        path.join('catalogs', 'details', `${term}.json`),
      );

      return {
        term,
        label: snapshotJson.term_label,
        dateRange: parseDateRange(snapshotJson.term_date_range, term),
        frozen: false,
        generatedAt: snapshotJson.generated_at,
        snapshot,
        details,
        manifest,
      };
    }),
  );
  const currentTerms = terms.filter((term) => term !== null);
  const snapshotTermSet = new Set(snapshotTerms);
  const durableTerms =
    priorRegistry?.terms
      .filter((entry) => entry.frozen || !snapshotTermSet.has(entry.term))
      .map((entry) => ({ ...entry, frozen: true })) ?? [];
  currentTerms.sort((left, right) =>
    (left.dateRange?.start ?? left.term).localeCompare(
      right.dateRange?.start ?? right.term,
    ),
  );

  const currentRegistryEntries = currentTerms.map(
    ({
      term,
      label,
      dateRange,
      frozen,
      generatedAt,
      snapshot,
      details,
      manifest,
    }) => ({
      term,
      label,
      date_range: dateRange,
      frozen,
      generated_at: generatedAt,
      snapshot_path: `published-snapshots/${term}/${snapshot.sha256}.json`,
      detail_path: `published-details/${term}/${details.sha256}.json`,
      manifest_path: `published-manifests/${term}/${manifest.sha256}.json`,
    }),
  ) satisfies TermArchiveRegistryEntry[];
  const registryTerms = [...currentRegistryEntries, ...durableTerms];
  registryTerms.sort((left, right) =>
    (left.date_range?.start ?? left.term).localeCompare(
      right.date_range?.start ?? right.term,
    ),
  );
  const registry: TermArchiveRegistry = {
    last_update: metadata.last_update,
    terms: registryTerms,
  };

  return { registry, terms: currentTerms };
}

function parsePriorRegistry(value: unknown): TermArchiveRegistry | null {
  if (value === null) return null;
  if (
    !isObject(value) ||
    typeof value.last_update !== 'string' ||
    !Array.isArray(value.terms)
  )
    throw new Error('Durable Term Archive registry is invalid');
  const terms = value.terms.map(parsePriorEntry);
  if (new Set(terms.map(({ term }) => term)).size !== terms.length)
    throw new Error('Durable Term Archive has duplicate terms');
  return { last_update: value.last_update, terms };
}

function parsePriorEntry(value: unknown): TermArchiveRegistryEntry {
  if (
    !isObject(value) ||
    typeof value.term !== 'string' ||
    typeof value.label !== 'string' ||
    typeof value.frozen !== 'boolean' ||
    typeof value.generated_at !== 'string' ||
    typeof value.snapshot_path !== 'string' ||
    typeof value.manifest_path !== 'string'
  )
    throw new Error('Durable Term Archive entry is invalid');
  const dateRange = parseDateRange(value.date_range, value.term);
  assertContentAddressedPath(
    value.snapshot_path,
    'published-snapshots',
    value.term,
  );
  assertContentAddressedPath(
    value.manifest_path,
    'published-manifests',
    value.term,
  );
  const detailPath =
    typeof value.detail_path === 'string' ? value.detail_path : null;
  if (detailPath)
    assertContentAddressedPath(detailPath, 'published-details', value.term);
  return {
    term: value.term,
    label: value.label,
    date_range: dateRange,
    frozen: value.frozen,
    generated_at: value.generated_at,
    snapshot_path: value.snapshot_path,
    detail_path: detailPath,
    manifest_path: value.manifest_path,
  };
}

function assertContentAddressedPath(
  value: string,
  prefix: string,
  term: string,
) {
  const filename = value.split('/').at(-1);
  if (!filename || value !== `${prefix}/${term}/${filename}`)
    throw new Error('Durable Term Archive object path is invalid');
  const digest = filename.replace(/\.json$/u, '');
  if (!digest || !/^[a-f\d]{64}$/u.test(digest))
    throw new Error('Durable Term Archive object digest is invalid');
}

async function jsonTerms(directory: string) {
  return (await readdir(directory))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

async function artifact(filename: string, root: string): Promise<Artifact> {
  const body = await readFile(filename);
  return {
    body,
    path: path.relative(root, filename),
    sha256: createHash('sha256').update(body).digest('hex'),
    size: body.byteLength,
  };
}

function jsonArtifact(value: unknown, artifactPath: string): Artifact {
  const body = encodeCatalogPayload(value);
  return {
    body,
    path: artifactPath,
    sha256: createHash('sha256').update(body).digest('hex'),
    size: body.byteLength,
  };
}

function parseObject(label: string, body: Uint8Array) {
  const parsed: unknown = JSON.parse(decoder.decode(body));
  if (!isObject(parsed)) throw new Error(`${label} is not a JSON object`);
  return parsed;
}

function assertTerm(
  label: string,
  value: { [key: string]: unknown },
  term: string,
) {
  if (value.active_planning_term !== term)
    throw new Error(`${label} term mismatch for ${term}`);
}

function assertAcceptedManifest(
  manifest: { [key: string]: unknown },
  term: string,
) {
  if (!Array.isArray(manifest.cells) || !isObject(manifest.summary))
    throw new Error(`Import Manifest is invalid for ${term}`);
  const statuses = ['ok', 'empty', 'failed', 'partial'] as const;
  for (const status of statuses) {
    const actual = manifest.cells.filter(
      (cell) => isObject(cell) && cell.status === status && cell.term === term,
    ).length;
    if (manifest.summary[status] !== actual)
      throw new Error(`Import Manifest summary is invalid for ${term}`);
  }
  if (
    manifest.cells.some(
      (cell) =>
        !isObject(cell) ||
        cell.term !== term ||
        !statuses.includes(cell.status as (typeof statuses)[number]),
    )
  )
    throw new Error(`Import Manifest cells are invalid for ${term}`);
}

function parseDateRange(value: unknown, term: string) {
  if (value === null) return null;
  if (
    !isObject(value) ||
    typeof value.start !== 'string' ||
    typeof value.end !== 'string'
  )
    throw new Error(`Published Snapshot date range is invalid for ${term}`);
  return { start: value.start, end: value.end };
}
