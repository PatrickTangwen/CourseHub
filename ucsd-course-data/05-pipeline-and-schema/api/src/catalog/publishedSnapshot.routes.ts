import type express from 'express';
import asyncHandler from 'express-async-handler';

import { createPublishedSnapshotResponse } from './publishedSnapshot.response.js';
import type { PublishedSnapshotStore } from './publishedSnapshot.store.js';

async function sendResponse(
  req: express.Request,
  res: express.Response,
  response: Response | null,
  next: express.NextFunction,
) {
  if (!response) {
    next();
    return;
  }
  res.status(response.status);
  response.headers.forEach((value, name) => res.set(name, value));
  if (!response.body) {
    res.end();
    return;
  }

  const reader =
    response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    if (!res.write(result.value)) {
      await new Promise<void>((resolve) => {
        res.once('drain', resolve);
      });
    }
  }
  res.end();
}

export function registerPublishedSnapshotRoutes(
  app: express.IRouter,
  store: PublishedSnapshotStore,
) {
  app.get(
    '/api/catalog/metadata',
    asyncHandler(async (req, res, next) => {
      await sendResponse(req, res, await responseFor(req, store), next);
    }),
  );
  app.get(
    '/api/catalog/public/:term',
    asyncHandler(async (req, res, next) => {
      await sendResponse(req, res, await responseFor(req, store), next);
    }),
  );
  app.get(
    '/api/catalog/details/:term',
    asyncHandler(async (req, res, next) => {
      await sendResponse(req, res, await responseFor(req, store), next);
    }),
  );
}

function responseFor(req: express.Request, store: PublishedSnapshotStore) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value))
      for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  return createPublishedSnapshotResponse(req.method, req.path, headers, store);
}
