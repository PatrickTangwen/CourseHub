export type GeneralCatalogCourse = {
  course_id: string;
  subject: string;
  course_number: string;
  title: string;
  units: string | null;
  description: string | null;
  prerequisites_text: string | null;
  restrictions_text: string | null;
  catalog_url: string;
};

export type RawGeneralCatalogSource = {
  subject: string;
  source_url: string;
  fetched_at: string;
  html: string;
};

type FetchAdapter = typeof fetch;

const catalogBaseUrl = 'https://catalog.ucsd.edu/courses';

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

function normalizeHtmlText(value: string): string {
  return decodeHtml(stripTags(value)).replace(/\s+/gu, ' ').trim();
}

function nullableText(value: string): string | null {
  return value || null;
}

function normalizeCourseNumber(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/gu, '');
}

function catalogCourseNumberAliases(value: string): string[] {
  const normalized = normalizeCourseNumber(value);
  if (!normalized.endsWith('/R')) return [normalized];
  return [normalized.replace(/\/R$/u, ''), normalized.replace(/\/R$/u, 'R')];
}

function normalizeSubject(value: string): string {
  return value.trim().toUpperCase();
}

export function crossListedCourseIds(description: string | null): string[] {
  if (!description) return [];
  const courseIds = new Set<string>();
  for (const match of description.matchAll(
    /\bcross-listed with (?<list>[^.)]+)/giu,
  )) {
    const list = match.groups?.list;
    if (!list) continue;
    for (const listing of list.matchAll(
      /\b(?<subject>[A-Z][A-Z\d]{1,7})\s+(?<course>\d+[A-Z]*(?:\/R)?)/gu,
    )) {
      const subject = listing.groups?.subject;
      const course = listing.groups?.course;
      if (!subject || !course) continue;
      courseIds.add(
        `${normalizeSubject(subject)}:${normalizeCourseNumber(course).replace(/\/R$/u, 'R')}`,
      );
    }
  }
  return [...courseIds];
}

type ParsedCatalogListing = {
  subject: string;
  courseNumber: string;
};

function parseCourseName(value: string): {
  listings: ParsedCatalogListing[];
  title: string;
  units: string | null;
} {
  const normalized = normalizeHtmlText(value);
  const parsedHeader = parseCourseHeaderText(normalized);
  if (!parsedHeader) {
    throw new Error(
      `UCSD General Catalog course name is invalid: ${normalized}`,
    );
  }

  const { listings, rest } = parsedHeader;
  let units: string | null = null;
  let unitStart = -1;

  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] !== '(') continue;
    const end = rest.indexOf(')', index + 1);
    if (end === -1) break;
    const candidate = rest.slice(index + 1, end).trim();
    if (/\d/u.test(candidate)) {
      units = candidate;
      unitStart = index;
    }
    index = end;
  }

  if (!units) {
    return {
      listings,
      title: rest.trim(),
      units: null,
    };
  }

  return {
    listings,
    title: rest.slice(0, unitStart).trim(),
    units,
  };
}

function splitGroupedSubjectCourse(
  subject: string,
  value: string,
): { listings: ParsedCatalogListing[]; rest: string } | null {
  const trimmed = value.trim();
  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace === -1) return null;
  const courseNumber = trimmed.slice(0, firstSpace).replace(/\.$/u, '');
  const rest = trimmed.slice(firstSpace + 1).trim();
  if (!courseNumber || !rest) return null;
  return {
    listings: [
      {
        subject: normalizeSubject(subject),
        courseNumber: normalizeCourseNumber(courseNumber),
      },
    ],
    rest,
  };
}

function skipSpaces(value: string, index: number): number {
  let cursor = index;
  while (cursor < value.length && /\s/u.test(value[cursor] ?? '')) cursor += 1;
  return cursor;
}

function parseSubjectList(value: string, index: number) {
  let cursor = index;
  while (cursor < value.length && /[a-z\d/]/iu.test(value[cursor] ?? ''))
    cursor += 1;
  const subjects = value
    .slice(index, cursor)
    .split('/')
    .filter((subject) => subject.length > 0);
  if (!subjects.length) return null;
  if (!subjects.every((subject) => /^[a-z][a-z\d]+$/iu.test(subject)))
    return null;
  return {
    subjects: subjects.map(normalizeSubject),
    nextIndex: cursor,
  };
}

function parseCourseNumberToken(value: string, index: number) {
  let cursor = index;
  while (cursor < value.length && /[a-z\d]/iu.test(value[cursor] ?? ''))
    cursor += 1;
  let courseNumber = value.slice(index, cursor);
  if (!courseNumber) return null;

  if (value.slice(cursor, cursor + 2).toUpperCase() === '/R') {
    const afterSlashR = value[cursor + 2] ?? '';
    if (!afterSlashR || afterSlashR === '.' || /\s/u.test(afterSlashR)) {
      courseNumber += value.slice(cursor, cursor + 2);
      cursor += 2;
    }
  }

  return {
    courseNumber: normalizeCourseNumber(courseNumber),
    nextIndex: cursor,
  };
}

function courseNumberParts(courseNumber: string) {
  const match = /^(?<digits>\d+)(?<suffix>[A-Z]*)$/u.exec(courseNumber);
  const digits = match?.groups?.digits;
  const suffix = match?.groups?.suffix;
  if (digits === undefined || suffix === undefined) return null;
  return {
    digits,
    suffix,
  };
}

function courseNumberFromFragment(
  firstCourseNumber: string,
  fragment: string,
): string {
  if (/^\d/u.test(fragment)) return normalizeCourseNumber(fragment);
  const firstParts = courseNumberParts(firstCourseNumber);
  if (!firstParts) return normalizeCourseNumber(fragment);
  const { digits } = firstParts;
  return `${digits}${normalizeCourseNumber(fragment)}`;
}

function rangeCourseNumbers(
  previousCourseNumber: string,
  endCourseNumber: string,
): string[] {
  const previousParts = courseNumberParts(previousCourseNumber);
  const endParts = courseNumberParts(endCourseNumber);
  if (
    !previousParts ||
    !endParts ||
    previousParts.digits !== endParts.digits ||
    previousParts.suffix.length !== 1 ||
    endParts.suffix.length !== 1
  )
    return [endCourseNumber];

  const start = previousParts.suffix.charCodeAt(0);
  const end = endParts.suffix.charCodeAt(0);
  if (end <= start) return [endCourseNumber];

  const { digits } = previousParts;
  return Array.from({ length: end - start }, (_, index) => {
    const suffix = String.fromCharCode(start + index + 1);
    return `${digits}${suffix}`;
  });
}

function isCourseNumberDash(value: string | undefined): boolean {
  return value === '-' || value === '–';
}

function parseCourseNumberSequence(value: string, index: number) {
  const firstCourseNumberResult = parseCourseNumberToken(value, index);
  if (!firstCourseNumberResult) return null;

  const courseNumbers = [firstCourseNumberResult.courseNumber];
  let cursor = firstCourseNumberResult.nextIndex;

  while (isCourseNumberDash(value[cursor])) {
    cursor += 1;
    const fragmentResult = parseCourseNumberToken(value, cursor);
    if (!fragmentResult) return null;
    const expanded = courseNumberFromFragment(
      courseNumbers[0]!,
      fragmentResult.courseNumber,
    );
    courseNumbers.push(...rangeCourseNumbers(courseNumbers.at(-1)!, expanded));
    cursor = fragmentResult.nextIndex;
  }

  return {
    courseNumbers,
    nextIndex: cursor,
  };
}

function parseCatalogListings(
  value: string,
): { listings: ParsedCatalogListing[]; rest: string } | null {
  const listings: ParsedCatalogListing[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    const subjectResult = parseSubjectList(value, cursor);
    if (!subjectResult) return null;
    cursor = skipSpaces(value, subjectResult.nextIndex);

    const courseNumbers: string[] = [];
    const courseNumberResult = parseCourseNumberSequence(value, cursor);
    if (!courseNumberResult) return null;
    courseNumbers.push(...courseNumberResult.courseNumbers);
    cursor = courseNumberResult.nextIndex;

    while (value[cursor] === '/' && /\d/u.test(value[cursor + 1] ?? '')) {
      const nextCourseNumberResult = parseCourseNumberSequence(
        value,
        cursor + 1,
      );
      if (!nextCourseNumberResult) return null;
      courseNumbers.push(...nextCourseNumberResult.courseNumbers);
      cursor = nextCourseNumberResult.nextIndex;
    }

    for (const subject of subjectResult.subjects) {
      for (const courseNumber of courseNumbers) {
        listings.push({
          subject,
          courseNumber,
        });
      }
    }

    const nextChar = value[cursor];
    if (nextChar === '/') {
      cursor += 1;
      continue;
    }

    if (nextChar === ',') {
      cursor = skipSpaces(value, cursor + 1);
      continue;
    }

    if (nextChar === '.') {
      const rest = value.slice(cursor + 1).trim();
      return rest ? { listings, rest } : null;
    }

    if (nextChar && /\s/u.test(nextChar)) {
      const rest = value.slice(cursor).trim();
      return rest ? { listings, rest } : null;
    }

    return null;
  }

  return null;
}

function parseCourseHeaderText(
  normalized: string,
): { listings: ParsedCatalogListing[]; rest: string } | null {
  const closeParen = normalized.indexOf(')');
  if (closeParen !== -1) {
    const openParen = normalized.lastIndexOf('(', closeParen);
    const groupedSubject = normalized.slice(openParen + 1, closeParen);
    const groupedCourse = splitGroupedSubjectCourse(
      groupedSubject,
      normalized.slice(closeParen + 1),
    );
    if (/^[A-Z][A-Z\d]+$/u.test(groupedSubject) && groupedCourse)
      return groupedCourse;
  }

  return parseCatalogListings(normalized);
}

function textByLabels(descriptionHtml: string): {
  description: string | null;
  prerequisitesText: string | null;
  restrictionsText: string | null;
} {
  const text = normalizeHtmlText(descriptionHtml);
  const labelMatches = [
    ...text.matchAll(/\b(?:prerequisites?|restrictions?):\s*/giu),
  ];
  if (!labelMatches.length) {
    return {
      description: nullableText(text),
      prerequisitesText: null,
      restrictionsText: null,
    };
  }

  const [firstLabel] = labelMatches;
  if (!firstLabel) {
    return {
      description: nullableText(text),
      prerequisitesText: null,
      restrictionsText: null,
    };
  }
  let prerequisitesText: string | null = null;
  let restrictionsText: string | null = null;

  for (const [index, match] of labelMatches.entries()) {
    const label = match[0].toLowerCase();
    const start = match.index + match[0].length;
    const end = labelMatches[index + 1]?.index ?? text.length;
    const value = nullableText(text.slice(start, end).trim());
    if (!value) continue;
    if (label.startsWith('prerequisite')) prerequisitesText = value;
    else if (label.startsWith('restriction')) restrictionsText = value;
  }

  return {
    description: nullableText(text.slice(0, firstLabel.index).trim()),
    prerequisitesText,
    restrictionsText,
  };
}

function catalogUrl(sourceUrl: string, anchorId: string | undefined): string {
  if (!anchorId) return sourceUrl;
  const url = new URL(sourceUrl);
  url.hash = anchorId;
  return url.toString();
}

function anchorIds(anchorHtml: string): string[] {
  return [...anchorHtml.matchAll(/\bid=["'](?<anchorId>[^"']+)["']/giu)]
    .map((match) => match.groups?.anchorId)
    .filter((anchorId) => anchorId !== undefined);
}

function catalogAnchorId(
  anchorHtml: string,
  subject: string,
  rawCourseNumber: string,
  courseNumber: string,
): string | undefined {
  const ids = anchorIds(anchorHtml);
  const expectedAnchor = `${subject}${courseNumber}`
    .replaceAll(/[^a-z\d]/giu, '')
    .toLowerCase();
  if (ids.includes(expectedAnchor)) return expectedAnchor;

  if (rawCourseNumber.endsWith('/R') && ids.length > 1) {
    if (courseNumber.endsWith('R')) return ids.at(-1);
    return ids[0];
  }
  return ids.at(-1);
}

function paragraphClassNames(attrs: string): string[] {
  const match = /\bclass\s*=\s*["'](?<className>[^"']*)["']/iu.exec(attrs);
  return match?.groups?.className?.split(/\s+/u) ?? [];
}

function paragraphHasClass(attrs: string, className: string): boolean {
  return paragraphClassNames(attrs).includes(className);
}

export function parseGeneralCatalogHtml(
  html: string,
  options: {
    subject: string;
    sourceUrl: string;
  },
): GeneralCatalogCourse[] {
  const expectedSubject = normalizeSubject(options.subject);
  const paragraphPattern = /<p\b(?<attrs>[^>]*)>(?<html>[\s\S]*?)<\/p>/giu;
  const paragraphs = [...html.matchAll(paragraphPattern)].map((match) => ({
    attrs: match.groups?.attrs ?? '',
    html: match.groups?.html ?? '',
  }));

  const courses = paragraphs.flatMap((paragraph, index) => {
    if (!paragraphHasClass(paragraph.attrs, 'course-name')) return [];
    const descriptionParagraph = paragraphs[index + 1];
    if (!descriptionParagraph) return [];
    if (paragraphHasClass(descriptionParagraph.attrs, 'course-name')) return [];
    if (paragraphHasClass(descriptionParagraph.attrs, 'anchor-parent'))
      return [];

    let anchorHtml = '';
    for (let anchorIndex = index - 1; anchorIndex >= 0; anchorIndex -= 1) {
      const anchorParagraph = paragraphs[anchorIndex];
      if (!anchorParagraph) break;
      if (!paragraphHasClass(anchorParagraph.attrs, 'anchor-parent')) break;
      anchorHtml = `${anchorParagraph.html}${anchorHtml}`;
    }

    const nameHtml = paragraph.html;
    const descriptionHtml = descriptionParagraph.html;
    const parsedName = parseCourseName(nameHtml);
    const parsedDescription = textByLabels(descriptionHtml);
    return parsedName.listings
      .filter((listing) => listing.subject === expectedSubject)
      .flatMap((listing) =>
        catalogCourseNumberAliases(listing.courseNumber).map(
          (courseNumber) => ({
            course_id: `${listing.subject}:${courseNumber}`,
            subject: listing.subject,
            course_number: courseNumber,
            title: parsedName.title,
            units: parsedName.units,
            description: parsedDescription.description,
            prerequisites_text: parsedDescription.prerequisitesText,
            restrictions_text: parsedDescription.restrictionsText,
            catalog_url: catalogUrl(
              options.sourceUrl,
              catalogAnchorId(
                anchorHtml,
                listing.subject,
                listing.courseNumber,
                courseNumber,
              ),
            ),
          }),
        ),
      );
  });

  if (!courses.length) {
    throw new Error(
      `UCSD General Catalog courses not found for ${expectedSubject}`,
    );
  }

  return courses;
}

function subjectCatalogUrl(subject: string): string {
  return `${catalogBaseUrl}/${encodeURIComponent(normalizeSubject(subject))}.html`;
}

export async function fetchRawGeneralCatalogForSubject(
  subject: string,
  options: {
    fetch?: FetchAdapter;
    fetchedAt?: string;
    catalogPage?: string;
  } = {},
): Promise<RawGeneralCatalogSource> {
  const fetchAdapter = options.fetch ?? fetch;
  const sourceUrl = subjectCatalogUrl(options.catalogPage ?? subject);
  const response = await fetchAdapter(sourceUrl);

  if (!response.ok) {
    throw new Error(
      `UCSD General Catalog query failed for ${normalizeSubject(subject)}: ${response.status} ${response.statusText}`,
    );
  }

  return {
    subject: normalizeSubject(subject),
    source_url: sourceUrl,
    fetched_at: options.fetchedAt ?? new Date().toISOString(),
    html: await response.text(),
  };
}

export async function fetchGeneralCatalogForSubject(
  subject: string,
  options: {
    fetch?: FetchAdapter;
    catalogPage?: string;
  } = {},
): Promise<GeneralCatalogCourse[]> {
  const rawSource = await fetchRawGeneralCatalogForSubject(subject, options);
  return parseGeneralCatalogHtml(rawSource.html, {
    subject,
    sourceUrl: rawSource.source_url,
  });
}

export async function fetchGeneralCatalogForSubjects(
  subjects: string[],
  options: {
    fetch?: FetchAdapter;
  } = {},
): Promise<GeneralCatalogCourse[]> {
  const courses: GeneralCatalogCourse[] = [];
  for (const subject of subjects)
    courses.push(...(await fetchGeneralCatalogForSubject(subject, options)));
  return courses;
}
