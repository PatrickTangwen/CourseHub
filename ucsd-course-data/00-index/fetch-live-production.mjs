import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const outputRoot = join(
  packageRoot,
  '01-current-published-data',
  'live-production-api-2026-08-15',
);
const origin = 'https://sungridplanner.com';

const downloadJson = async (path, outputPath) => {
  const url = `${origin}${path}`;
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`${url} returned unexpected Content-Type ${contentType}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  JSON.parse(bytes.toString('utf8'));
  await writeFile(outputPath, bytes);
  return {
    url,
    output: outputPath.slice(packageRoot.length + 1),
    fetched_at: new Date().toISOString(),
    http_status: response.status,
    content_type: contentType,
    cache_control: response.headers.get('cache-control'),
    etag: response.headers.get('etag'),
    bytes: bytes.length,
  };
};

await mkdir(join(outputRoot, 'public'), { recursive: true });
await mkdir(join(outputRoot, 'details'), { recursive: true });

const downloads = [];
downloads.push(
  await downloadJson(
    '/api/catalog/metadata',
    join(outputRoot, 'metadata.json'),
  ),
);
const metadata = JSON.parse(
  await readFile(join(outputRoot, 'metadata.json'), 'utf8'),
);
const terms = [...new Set(metadata.terms.map((entry) => entry.term))].sort();

for (const term of terms) {
  downloads.push(
    await downloadJson(
      `/api/catalog/public/${term}`,
      join(outputRoot, 'public', `${term}.json`),
    ),
  );
  downloads.push(
    await downloadJson(
      `/api/catalog/details/${term}`,
      join(outputRoot, 'details', `${term}.json`),
    ),
  );
}

const manifest = {
  generated_at: new Date().toISOString(),
  origin,
  metadata_last_update: metadata.last_update,
  terms,
  downloads,
  total_bytes: downloads.reduce((sum, entry) => sum + entry.bytes, 0),
};
await writeFile(
  join(outputRoot, 'download-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(JSON.stringify(manifest, null, 2));
