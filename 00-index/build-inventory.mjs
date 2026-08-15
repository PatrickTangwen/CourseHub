import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const indexDir = resolve(import.meta.dirname);
const packageRoot = resolve(indexDir, '..');
const publishedRoot = join(
  packageRoot,
  '01-current-published-data',
  'api',
  'static',
);
const catalogRoot = join(publishedRoot, 'catalogs');

const csvCell = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const csv = (header, rows) =>
  `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;

const walk = async (root) => {
  const files = [];
  const visit = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await visit(root);
  return files.sort();
};

const metadata = JSON.parse(
  await readFile(join(publishedRoot, 'metadata.json'), 'utf8'),
);
const termRows = [];
const catalogLinkRows = [];
const referenceUrls = new Map();

const addUrl = (url, source) => {
  if (typeof url !== 'string' || !/^https?:\/\//u.test(url)) return;
  if (!referenceUrls.has(url)) referenceUrls.set(url, new Set());
  referenceUrls.get(url).add(source);
};

for (const termEntry of metadata.terms) {
  const term = termEntry.term;
  const snapshotPath = join(catalogRoot, 'public', `${term}.json`);
  const manifestPath = join(catalogRoot, 'import-manifests', `${term}.json`);
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const sections = snapshot.courses.flatMap((course) => course.sections ?? []);
  const meetings = sections.flatMap((section) => section.meetings ?? []);
  const gradeRecords = snapshot.courses.flatMap(
    (course) => course.grade_archive_records ?? [],
  );
  const coursesWithDescriptions = snapshot.courses.filter(
    (course) =>
      course.description &&
      !/^No description available\.?$/iu.test(course.description),
  ).length;
  const sectionsWithAvailability = sections.filter(
    (section) =>
      section.available_seats != null ||
      section.capacity != null ||
      section.enrolled != null,
  ).length;

  for (const course of snapshot.courses) {
    if (course.catalog_url) {
      catalogLinkRows.push([
        term,
        course.course_id,
        course.title,
        course.catalog_url,
      ]);
      addUrl(course.catalog_url, `published snapshot ${term}`);
    }
    for (const section of course.sections ?? []) {
      addUrl(section.raw?.source_url, `published snapshot ${term} source`);
    }
  }

  const snapshotStats = await stat(snapshotPath);
  const manifestStats = await stat(manifestPath);
  termRows.push([
    term,
    termEntry.label,
    snapshot.generated_at,
    termEntry.frozen,
    snapshot.courses.length,
    sections.length,
    meetings.length,
    coursesWithDescriptions,
    sectionsWithAvailability,
    gradeRecords.length,
    manifest.summary?.ok ?? 0,
    manifest.summary?.empty ?? 0,
    manifest.summary?.failed ?? 0,
    manifest.summary?.partial ?? 0,
    snapshotStats.size,
    manifestStats.size,
  ]);
}

await writeFile(
  join(indexDir, 'terms-summary.csv'),
  csv(
    [
      'term',
      'label',
      'generated_at',
      'frozen',
      'courses',
      'sections',
      'meetings',
      'courses_with_descriptions',
      'sections_with_availability',
      'grade_archive_records',
      'manifest_ok_cells',
      'manifest_empty_cells',
      'manifest_failed_cells',
      'manifest_partial_cells',
      'snapshot_bytes',
      'manifest_bytes',
    ],
    termRows,
  ),
);

await writeFile(
  join(indexDir, 'course-catalog-links.csv'),
  csv(['term', 'course_id', 'title', 'catalog_url'], catalogLinkRows),
);

const textRoots = [
  join(packageRoot, '03-links'),
  join(packageRoot, '04-documentation'),
  join(packageRoot, '05-pipeline-and-schema'),
  join(packageRoot, '02-complete-local-data-history', 'TSS_相关资料'),
  join(packageRoot, '02-complete-local-data-history', 'exports'),
];
const urlPattern = /https?:\/\/[^\s<>"'`\])}]+/gu;

for (const root of textRoots) {
  let files;
  try {
    files = await walk(root);
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  for (const file of files) {
    const fileStats = await stat(file);
    if (fileStats.size > 100_000_000) continue;
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(urlPattern)) {
      const url = match[0].replace(/[.,;:]+$/u, '');
      addUrl(url, relative(packageRoot, file));
    }
  }
}

const referenceUrlRows = [...referenceUrls.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([url, sources]) => [url, [...sources].sort().join(' | ')]);
await writeFile(
  join(indexDir, 'all-reference-urls.csv'),
  csv(['url', 'found_in'], referenceUrlRows),
);

const generatedIndexFiles = new Set([
  '00-index/file-manifest.csv',
  '00-index/inventory-summary.json',
]);
const allFiles = await walk(packageRoot);
const fileRows = [];
const groupStats = new Map();
for (const file of allFiles) {
  const path = relative(packageRoot, file);
  if (generatedIndexFiles.has(path)) continue;
  const fileStats = await stat(file);
  const group = path.split('/')[0];
  fileRows.push([path, fileStats.size, extname(file).toLowerCase(), group]);
  const current = groupStats.get(group) ?? { files: 0, logical_bytes: 0 };
  current.files += 1;
  current.logical_bytes += fileStats.size;
  groupStats.set(group, current);
}

await writeFile(
  join(indexDir, 'file-manifest.csv'),
  csv(['relative_path', 'size_bytes', 'extension', 'group'], fileRows),
);

const totals = termRows.reduce(
  (result, row) => ({
    courses: result.courses + Number(row[4]),
    sections: result.sections + Number(row[5]),
    meetings: result.meetings + Number(row[6]),
    grade_archive_records: result.grade_archive_records + Number(row[9]),
  }),
  { courses: 0, sections: 0, meetings: 0, grade_archive_records: 0 },
);

const summary = {
  generated_at: new Date().toISOString(),
  package_root: packageRoot,
  current_published_data: {
    source_branch: 'origin/main',
    source_commit: '009b922ff3cd87344c30f5923b3920619e50caf7',
    metadata_last_update: metadata.last_update,
    terms: termRows.length,
    ...totals,
    catalog_link_rows: catalogLinkRows.length,
    unique_reference_urls: referenceUrlRows.length,
  },
  groups: Object.fromEntries(
    [...groupStats.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  ),
  file_manifest_rows: fileRows.length,
  note: 'Logical byte totals count APFS clone files at their full size; copy-on-write cloning keeps the package independent while initially consuming substantially less additional disk space on this filesystem.',
};
await writeFile(
  join(indexDir, 'inventory-summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
);

console.log(JSON.stringify(summary, null, 2));
