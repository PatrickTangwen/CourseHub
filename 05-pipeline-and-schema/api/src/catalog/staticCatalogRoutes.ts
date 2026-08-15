import express from 'express';

export const staticJSON = (path: string) =>
  express.static(path, {
    cacheControl: true,
    maxAge: '1h',
    lastModified: true,
    etag: true,
    extensions: ['json'],
  });
