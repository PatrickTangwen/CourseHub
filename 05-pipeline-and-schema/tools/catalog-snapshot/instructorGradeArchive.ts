export type GradeArchiveRecord = {
  subject: string;
  course: string;
  year: string;
  quarter: string;
  title: string | null;
  instructor: string | null;
  gpa: number | null;
  a: number | null;
  b: number | null;
  c: number | null;
  d: number | null;
  f: number | null;
  w: number | null;
  p: number | null;
  np: number | null;
  raw: { [key: string]: string };
  matched_via?: 'cross_listed';
};

export type RawInstructorGradeArchiveSource = {
  subject: string;
  source_url: string;
  fetched_at: string;
  html: string;
};

const instructorGradeArchiveUrl =
  'https://qa-as.ucsd.edu/Home/InstructorGradeArchive';

type FetchAdapter = typeof fetch;

const requiredHeaders = [
  'Subject',
  'Course',
  'Year',
  'Quarter',
  'Title',
  'Instructor',
  'GPA',
  'A',
  'B',
  'C',
  'D',
  'F',
  'W',
  'P',
  'NP',
] as const;

const namedEntities: { [key: string]: string } = {
  amp: '&',
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

function decodeEntity(entity: string, fallback: string): string {
  if (entity.startsWith('#x'))
    return String.fromCodePoint(parseInt(entity.slice(2), 16));
  if (entity.startsWith('#'))
    return String.fromCodePoint(Number(entity.slice(1)));
  return namedEntities[entity] ?? fallback;
}

function decodeHtml(value: string): string {
  let decoded = '';
  let lastIndex = 0;
  for (const match of value.matchAll(/&(?<entity>#\d+|#x[\da-f]+|\w+);/giu)) {
    const entity = match.groups?.entity;
    if (!entity) continue;
    decoded +=
      value.slice(lastIndex, match.index) + decodeEntity(entity, match[0]);
    lastIndex = match.index + match[0].length;
  }
  return decoded + value.slice(lastIndex);
}

function stripTags(value: string): string {
  let text = '';
  let insideTag = false;
  for (const char of value) {
    if (char === '<') {
      insideTag = true;
      text += ' ';
    } else if (char === '>') {
      insideTag = false;
      text += ' ';
    } else if (!insideTag) {
      text += char;
    }
  }
  return text;
}

function normalizeCell(value: string): string {
  return decodeHtml(stripTags(value)).replace(/\s+/gu, ' ').trim();
}

function parseCellNumber(value: string): number | null {
  if (!value) return null;
  const parsed = Number(value.trim().replace(/%$/u, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableText(value: string): string | null {
  return value || null;
}

function tableBody(html: string): string {
  for (const match of html.matchAll(/<table(?:\s[^>]*)?>/giu)) {
    const [tag] = match;
    if (!/\sid=["']datatable-responsive["']/iu.test(tag)) continue;
    const tableStart = match.index + tag.length;
    const tableEnd = html.indexOf('</table>', tableStart);
    if (tableEnd !== -1) return html.slice(tableStart, tableEnd);
  }
  throw new Error('Instructor Grade Archive table not found');
}

function extractCells(rowHtml: string, tagName: 'th' | 'td'): string[] {
  const cellPattern = new RegExp(
    `<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`,
    'giu',
  );
  return [...rowHtml.matchAll(cellPattern)].map((match) =>
    normalizeCell(match[1] ?? ''),
  );
}

function tagContents(html: string, tagName: string): string[] {
  const tagPattern = new RegExp(
    `<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`,
    'giu',
  );
  return [...html.matchAll(tagPattern)].map((match) => match[1] ?? '');
}

function parseHeaders(tableHtml: string): string[] {
  const [theadHtml = ''] = tagContents(tableHtml, 'thead');
  const [headerRow] = tagContents(theadHtml, 'tr');
  if (!headerRow)
    throw new Error('Instructor Grade Archive header row not found');
  const headers = extractCells(headerRow, 'th');
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length) {
    throw new Error(
      `Instructor Grade Archive table missing columns: ${missing.join(', ')}`,
    );
  }
  return headers;
}

function parseRows(tableHtml: string): string[][] {
  const bodyHtml = tagContents(tableHtml, 'tbody')[0] ?? tableHtml;
  return tagContents(bodyHtml, 'tr')
    .map((row) => extractCells(row, 'td'))
    .filter((cells) => cells.length > 0);
}

function buildRecord(raw: { [key: string]: string }): GradeArchiveRecord {
  return {
    subject: raw.Subject ?? '',
    course: raw.Course ?? '',
    year: raw.Year ?? '',
    quarter: raw.Quarter ?? '',
    title: nullableText(raw.Title ?? ''),
    instructor: nullableText(raw.Instructor ?? ''),
    gpa: parseCellNumber(raw.GPA ?? ''),
    a: parseCellNumber(raw.A ?? ''),
    b: parseCellNumber(raw.B ?? ''),
    c: parseCellNumber(raw.C ?? ''),
    d: parseCellNumber(raw.D ?? ''),
    f: parseCellNumber(raw.F ?? ''),
    w: parseCellNumber(raw.W ?? ''),
    p: parseCellNumber(raw.P ?? ''),
    np: parseCellNumber(raw.NP ?? ''),
    raw,
  };
}

export function parseInstructorGradeArchiveHtml(
  html: string,
): GradeArchiveRecord[] {
  const tableHtml = tableBody(html);
  const headers = parseHeaders(tableHtml);
  return parseRows(tableHtml).map((cells) => {
    const raw: { [key: string]: string } = {};
    headers.forEach((header, index) => {
      raw[header] = cells[index] ?? '';
    });
    return buildRecord(raw);
  });
}

export async function fetchRawInstructorGradeArchiveForSubject(
  subject: string,
  options: {
    fetch?: FetchAdapter;
    fetchedAt?: string;
  } = {},
): Promise<RawInstructorGradeArchiveSource> {
  const fetchAdapter = options.fetch ?? fetch;
  const body = new URLSearchParams({
    quarter: '',
    year: '',
    instructor: '',
    subject,
    courseNumber: '',
  });
  const response = await fetchAdapter(instructorGradeArchiveUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(
      `Instructor Grade Archive query failed for ${subject}: ${response.status} ${response.statusText}`,
    );
  }

  return {
    subject: subject.trim().toUpperCase(),
    source_url: instructorGradeArchiveUrl,
    fetched_at: options.fetchedAt ?? new Date().toISOString(),
    html: await response.text(),
  };
}

export async function fetchInstructorGradeArchiveForSubject(
  subject: string,
  options: {
    fetch?: FetchAdapter;
  } = {},
): Promise<GradeArchiveRecord[]> {
  const rawSource = await fetchRawInstructorGradeArchiveForSubject(
    subject,
    options,
  );
  return parseInstructorGradeArchiveHtml(rawSource.html);
}

export async function fetchInstructorGradeArchiveForSubjects(
  subjects: string[],
  options: {
    fetch?: FetchAdapter;
  } = {},
): Promise<GradeArchiveRecord[]> {
  const records: GradeArchiveRecord[] = [];
  for (const subject of subjects) {
    records.push(
      ...(await fetchInstructorGradeArchiveForSubject(subject, options)),
    );
  }
  return records;
}
