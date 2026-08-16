export interface PublishedSnapshotAsset {
  body: ReadableStream<Uint8Array>;
  cacheControl?: string;
  contentLength: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
}

export interface PublishedSnapshotStore {
  openMetadata: () => Promise<PublishedSnapshotAsset | null>;
  openSnapshot: (term: string) => Promise<PublishedSnapshotAsset | null>;
  openDetails: (term: string) => Promise<PublishedSnapshotAsset | null>;
}
