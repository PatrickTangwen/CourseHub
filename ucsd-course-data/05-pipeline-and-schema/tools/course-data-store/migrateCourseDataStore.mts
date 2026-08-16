import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import postgres from 'postgres';

export async function migrateCourseDataStore(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 1 });
  const migrationsDirectory = path.resolve(
    import.meta.dirname,
    '../../course-data-store/migrations',
  );

  try {
    await sql`create schema if not exists course_data_migrations`;
    await sql`
      create table if not exists course_data_migrations.applied_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `;

    const filenames = (await readdir(migrationsDirectory))
      .filter((filename) => filename.endsWith('.sql'))
      .sort();
    for (const filename of filenames) {
      const [existing] = await sql<{ exists: boolean }[]>`
        select exists(
          select 1 from course_data_migrations.applied_migrations
          where filename = ${filename}
        ) as exists
      `;
      if (existing?.exists) continue;

      const migration = await readFile(
        path.join(migrationsDirectory, filename),
        'utf8',
      );
      await sql.begin(async (transaction) => {
        const tx = transaction as unknown as typeof sql;
        await tx.unsafe(migration);
        await tx`
          insert into course_data_migrations.applied_migrations (filename)
          values (${filename})
        `;
      });
    }
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  const databaseUrl = process.env.COURSE_DATA_STORE_DATABASE_URL;
  if (!databaseUrl)
    throw new Error('env config missing: COURSE_DATA_STORE_DATABASE_URL');
  await migrateCourseDataStore(databaseUrl);
}
