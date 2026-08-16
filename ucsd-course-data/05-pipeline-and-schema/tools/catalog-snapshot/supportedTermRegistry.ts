import type { CatalogSnapshot } from './catalogSnapshot';
import {
  createFileSnapshotStorage,
  type SnapshotStorage,
} from './snapshotStorage';

export type SupportedTermEntry = {
  term: string;
  label: string;
  date_range: CatalogSnapshot['term_date_range'];
  frozen: boolean;
  generated_at: string;
  snapshot_path: string;
  manifest_path: string | null;
};

/**
 * The Supported Term registry advertised at `metadata.json`. It replaces the
 * single-term metadata pointer: the frontend term selector is driven by this
 * list of Supported Terms (UCSD alpha codes). See ADR 0012.
 */
export type SupportedTermRegistry = {
  last_update: string;
  terms: SupportedTermEntry[];
};

export function supportedTermSnapshotPath(term: string): string {
  return `catalogs/public/${term}.json`;
}

export function supportedTermManifestPath(term: string): string {
  return `catalogs/import-manifests/${term}.json`;
}

export function buildSupportedTermRegistry(
  entries: SupportedTermEntry[],
  lastUpdate: string,
): SupportedTermRegistry {
  return {
    last_update: lastUpdate,
    terms: entries,
  };
}

export function readSupportedTermRegistry(
  metadataPath: string,
  storage: SnapshotStorage = createFileSnapshotStorage(),
): Promise<SupportedTermRegistry | null> {
  return storage.readJson<SupportedTermRegistry>(metadataPath);
}

export function writeSupportedTermRegistry(
  registry: SupportedTermRegistry,
  metadataPath: string,
  storage: SnapshotStorage = createFileSnapshotStorage(),
): Promise<string> {
  return storage.writeJson(metadataPath, registry);
}
