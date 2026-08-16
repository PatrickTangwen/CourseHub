import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function applyHasuraMetadata(
  endpoint: string,
  adminSecret: string,
) {
  const metadata = JSON.parse(
    await readFile(
      path.resolve(
        import.meta.dirname,
        '../../course-data-store/hasura/metadata.json',
      ),
      'utf8',
    ),
  ) as unknown;
  const response = await fetch(`${endpoint}/v1/metadata`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hasura-admin-secret': adminSecret,
    },
    body: JSON.stringify({ type: 'replace_metadata', args: metadata }),
  });
  if (!response.ok) throw new Error('Hasura metadata application failed');
}

if (import.meta.main) {
  const endpoint = process.env.COURSE_DATA_HASURA_ENDPOINT;
  const adminSecret = process.env.COURSE_DATA_HASURA_ADMIN_SECRET;
  if (!endpoint)
    throw new Error('env config missing: COURSE_DATA_HASURA_ENDPOINT');
  if (!adminSecret)
    throw new Error('env config missing: COURSE_DATA_HASURA_ADMIN_SECRET');
  await applyHasuraMetadata(endpoint, adminSecret);
}
