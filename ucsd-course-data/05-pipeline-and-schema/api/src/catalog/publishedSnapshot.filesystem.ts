import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import type {
  PublishedSnapshotAsset,
  PublishedSnapshotStore,
} from './publishedSnapshot.store.js';
import {
  encodeCatalogPayload,
  splitPublishedCatalogPayload,
} from '../../../shared/catalogPayload.js';

type DerivedPayload = {
  body: Uint8Array;
  etag: string;
};

type CachedPayloads = {
  fileSize: number;
  mtimeMs: number;
  lastModified: Date;
  list: DerivedPayload;
  details: DerivedPayload;
};

async function openFile(
  filename: string,
): Promise<PublishedSnapshotAsset | null> {
  const file = await getFileStat(filename);
  if (!file || !file.isFile()) return null;

  return {
    body: Readable.toWeb(
      createReadStream(filename),
    ) as ReadableStream<Uint8Array>,
    cacheControl: 'public, max-age=3600',
    contentLength: file.size,
    contentType: 'application/json; charset=utf-8',
    etag: `W/"${file.size.toString(16)}-${Math.trunc(file.mtimeMs).toString(16)}"`,
    lastModified: file.mtime,
  };
}

async function getFileStat(filename: string) {
  try {
    return await stat(filename);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

function payload(value: unknown): DerivedPayload {
  const body = encodeCatalogPayload(value);
  return {
    body,
    etag: `"${createHash('sha256').update(body).digest('hex')}"`,
  };
}

function openPayload(
  value: DerivedPayload,
  lastModified: Date,
): PublishedSnapshotAsset {
  return {
    body: Readable.toWeb(
      Readable.from([value.body]),
    ) as ReadableStream<Uint8Array>,
    cacheControl: 'public, max-age=3600',
    contentLength: value.body.byteLength,
    contentType: 'application/json; charset=utf-8',
    etag: value.etag,
    lastModified,
  };
}

export function createFilesystemPublishedSnapshotStore(
  staticDirectory: string,
): PublishedSnapshotStore {
  const cache = new Map<string, CachedPayloads>();
  const load = async (term: string) => {
    if (!/^[\w-]+$/u.test(term)) return null;
    const filename = path.join(
      staticDirectory,
      'catalogs',
      'public',
      `${term}.json`,
    );
    const file = await getFileStat(filename);
    if (!file?.isFile()) return null;
    const cached = cache.get(term);
    if (cached?.fileSize === file.size && cached.mtimeMs === file.mtimeMs)
      return cached;

    const canonical: unknown = JSON.parse(await readFile(filename, 'utf8'));
    const { listPayload, detailPayload } =
      splitPublishedCatalogPayload(canonical);
    const next = {
      fileSize: file.size,
      mtimeMs: file.mtimeMs,
      lastModified: file.mtime,
      list: payload(listPayload),
      details: payload(detailPayload),
    };
    cache.set(term, next);
    return next;
  };

  return {
    openMetadata: () => openFile(path.join(staticDirectory, 'metadata.json')),
    async openSnapshot(term) {
      const cached = await load(term);
      return cached ? openPayload(cached.list, cached.lastModified) : null;
    },
    async openDetails(term) {
      const cached = await load(term);
      return cached ? openPayload(cached.details, cached.lastModified) : null;
    },
  };
}
