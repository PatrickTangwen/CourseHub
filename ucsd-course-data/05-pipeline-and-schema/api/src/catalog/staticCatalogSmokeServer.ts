import path from 'node:path';

import express from 'express';

import { createFilesystemPublishedSnapshotStore } from './publishedSnapshot.filesystem.js';
import { registerPublishedSnapshotRoutes } from './publishedSnapshot.routes.js';

const port = Number(process.env.STATIC_CATALOG_SMOKE_PORT ?? 18_091);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
  throw new Error('STATIC_CATALOG_SMOKE_PORT must be a valid port');

const app = express();
registerPublishedSnapshotRoutes(
  app,
  createFilesystemPublishedSnapshotStore(
    path.resolve(import.meta.dirname, '../../static'),
  ),
);
app.get('/healthz', (_request, response) => response.json({ status: 'ok' }));
app.listen(port, '127.0.0.1');
