import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import pathModule from 'node:path';

export type SnapshotStorage = {
  readJson: <T>(pathname: string) => Promise<T | null>;
  writeJson: (pathname: string, value: unknown) => Promise<string>;
};

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function createFileSnapshotStorage(): SnapshotStorage {
  async function readJson<T>(pathname: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(pathname, 'utf-8')) as T;
    } catch (err) {
      if ((err as { code?: unknown }).code === 'ENOENT') return null;
      throw err;
    }
  }

  async function writeJson(pathname: string, value: unknown) {
    await mkdir(pathModule.dirname(pathname), { recursive: true });
    const tempPath = `${pathname}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
    try {
      await writeFile(tempPath, serializeJson(value), 'utf-8');
      await rename(tempPath, pathname);
    } catch (err) {
      await rm(tempPath, { force: true });
      throw err;
    }
    return pathname;
  }

  return { readJson, writeJson };
}

export type ObjectSnapshotStore = {
  getObject: (key: string) => Promise<string | null>;
  putObject: (
    key: string,
    body: string,
    options: { contentType: string },
  ) => Promise<void>;
};

export function createObjectSnapshotStorage(
  store: ObjectSnapshotStore,
): SnapshotStorage {
  async function readJson<T>(pathname: string): Promise<T | null> {
    const body = await store.getObject(pathname);
    return body ? (JSON.parse(body) as T) : null;
  }

  async function writeJson(pathname: string, value: unknown) {
    await store.putObject(pathname, serializeJson(value), {
      contentType: 'application/json; charset=utf-8',
    });
    return pathname;
  }

  return { readJson, writeJson };
}
