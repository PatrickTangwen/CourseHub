import type { CatalogSnapshot, CatalogSnapshotConfig } from './catalogSnapshot';

type FetchAdapter = typeof fetch;
type SnapshotCourse = CatalogSnapshot['courses'][number];
type SnapshotSection = SnapshotCourse['sections'][number];
type SnapshotMeeting = SnapshotSection['meetings'][number];

export type ParsedScheduleOfClasses = {
  subject: string;
  term: string;
  source_url: string;
  fetched_at: string;
  source_timestamp: string | null;
  courses: SnapshotCourse[];
};

export type RawScheduleOfClassesSource = {
  subject: string;
  term: string;
  fetched_at: string;
  subject_list_url: string;
  subject_list_raw: string;
  source_url: string;
  html: string;
};

type ParseOptions = {
  subject: string;
  term: string;
  sourceUrl: string;
  fetchedAt: string;
};

type FetchOptions = {
  term: string;
  fetch?: FetchAdapter;
  fetchedAt?: string;
  subjectList?: SubjectListSource;
};

export type SubjectListSource = {
  url: string;
  raw: string;
  subjects: { code: string; value: string }[];
};

type Cell = {
  html: string;
  text: string;
  colSpan: number;
};

const scheduleBaseUrl = 'https://act.ucsd.edu/scheduleOfClasses';
const scheduleResultUrl = `${scheduleBaseUrl}/scheduleOfClassesStudentResult.htm`;
const dayNames: { [key: string]: string } = {
  F: 'Friday',
  M: 'Monday',
  S: 'Saturday',
  Su: 'Sunday',
  Th: 'Thursday',
  Tu: 'Tuesday',
  W: 'Wednesday',
};

const courseOptionFields = [
  'schedOption1',
  'schedOption2',
  'schedOption3',
  'schedOption4',
  'schedOption5',
  'schedOption7',
  'schedOption8',
  'schedOption9',
  'schedOption10',
  'schedOption11',
  'schedOption12',
  'schedOption13',
];

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

function normalizeText(value: string): string {
  return decodeHtml(stripTags(value)).replace(/\s+/gu, ' ').trim();
}

function nullIfBlank(value: string): string | null {
  return value || null;
}

function attrValue(attrs: string, name: string): string | null {
  const pattern = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'iu',
  );
  const match = pattern.exec(attrs);
  if (!match) return null;
  return decodeHtml(match[1] ?? match[2] ?? match[3] ?? '');
}

function tagContents(html: string, tagName: string): string[] {
  const tagPattern = new RegExp(
    `<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`,
    'giu',
  );
  return [...html.matchAll(tagPattern)].map((match) => match[1] ?? '');
}

function extractCells(rowHtml: string): Cell[] {
  const cellPattern = /<td\b(?<attrs>[^>]*)>(?<html>[\s\S]*?)<\/td>/giu;
  return [...rowHtml.matchAll(cellPattern)].map((match) => {
    const attrs = match.groups?.attrs ?? '';
    const html = match.groups?.html ?? '';
    const colSpan = Number(attrValue(attrs, 'colspan') ?? '1');
    return {
      html,
      text: normalizeText(html),
      colSpan: Number.isFinite(colSpan) && colSpan > 0 ? colSpan : 1,
    };
  });
}

function expandedCells(cells: Cell[]): Cell[] {
  return cells.flatMap((cell) =>
    Array.from({ length: cell.colSpan }, () => cell),
  );
}

function classNameMatches(html: string, className: string): boolean {
  return new RegExp(`\\bclass\\s*=\\s*["'][^"']*\\b${className}\\b`, 'iu').test(
    html,
  );
}

function parseSourceTimestamp(html: string): string | null {
  const match = /as of:\s*(?<timestamp>[^<]+)/iu.exec(html);
  return match ? normalizeText(match.groups?.timestamp ?? '') : null;
}

function normalizeSubject(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeCourseNumber(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/gu, '').replace(/\/R$/u, 'R');
}

function courseId(subject: string, courseNumber: string): string {
  return `${normalizeSubject(subject)}:${normalizeCourseNumber(courseNumber)}`;
}

function sectionFamily(sectionCode: string | null): string {
  return sectionCode?.match(/^[A-Za-z]+/u)?.[0]?.toUpperCase() ?? '';
}

function firstSpanText(cellHtml: string, className: string): string | null {
  for (const match of cellHtml.matchAll(
    /<span\b(?<attrs>[^>]*)>(?<html>[\s\S]*?)<\/span>/giu,
  )) {
    if (!classNameMatches(match.groups?.attrs ?? '', className)) continue;
    return normalizeText(match.groups?.html ?? '');
  }
  return null;
}

function firstHref(cellHtml: string): string | null {
  const match = /<a\b(?<attrs>[^>]*)>/iu.exec(cellHtml);
  if (!match) return null;
  const href = attrValue(match.groups?.attrs ?? '', 'href');
  if (!href) return null;
  const openWindowMatch = /opennewwindow\('(?<url>[^']+)'/iu.exec(href);
  return openWindowMatch?.groups?.url ?? href;
}

function parseUnits(value: string): string | null {
  const match = /\(\s*(?<units>\d+(?:\.\d+)?)\s*units?\s*\)/iu.exec(value);
  return match?.groups?.units ?? null;
}

function parseCourseHeader(
  cells: Cell[],
  subject: string,
): SnapshotCourse | null {
  if (!cells.some((cell) => classNameMatches(cell.html, 'boldtxt')))
    return null;
  const courseNumber = normalizeCourseNumber(cells[1]?.text ?? '');
  if (!courseNumber) return null;
  const titleCell = cells.find((cell) => firstSpanText(cell.html, 'boldtxt'));
  const title = titleCell ? firstSpanText(titleCell.html, 'boldtxt') : null;
  if (!title) return null;
  const id = courseId(subject, courseNumber);

  return {
    course_id: id,
    subject: normalizeSubject(subject),
    course_number: courseNumber,
    title,
    units: parseUnits(cells.map((cell) => cell.text).join(' ')),
    description: null,
    prerequisites_text: null,
    restrictions_text: null,
    catalog_url: titleCell ? firstHref(titleCell.html) : null,
    archive_avg_gpa: null,
    archive_record_count: 0,
    grade_archive_records: [],
    ge_matches: [],
    sections: [],
  };
}

function meetingType(cell: Cell): string | null {
  const spanMatch = /<span\b(?<attrs>[^>]*)>/iu.exec(cell.html);
  const title = spanMatch
    ? attrValue(spanMatch.groups?.attrs ?? '', 'title')
    : null;
  return nullIfBlank(title ?? '') ?? nullIfBlank(cell.text);
}

function rawMeetingType(cell: Cell): string | null {
  return nullIfBlank(cell.text);
}

function hasMeetingTypeMarker(cell: Cell | undefined): boolean {
  if (!cell) return false;
  const spanMatch = /<span\b(?<attrs>[^>]*)>/iu.exec(cell.html);
  if (!spanMatch) return false;
  return attrValue(spanMatch.groups?.attrs ?? '', 'id') === 'insTyp';
}

function parseDays(rawDays: string | null): string[] {
  if (!rawDays || isUntimedValue(rawDays)) return [];
  const compact = rawDays.replace(/\s+/gu, '');
  const days: string[] = [];
  let index = 0;
  const tokens = [
    'Sun',
    'Su',
    'Thu',
    'Th',
    'Tue',
    'Tu',
    'Mon',
    'M',
    'Wed',
    'W',
    'Fri',
    'F',
    'Sat',
    'S',
  ];

  while (index < compact.length) {
    const token = tokens.find((candidate) =>
      compact.slice(index).toLowerCase().startsWith(candidate.toLowerCase()),
    );
    if (!token) return [];
    const normalized = token.length > 1 ? token.slice(0, 2) : token;
    const dayName = dayNames[normalized];
    if (dayName) days.push(dayName);
    index += token.length;
  }

  return days;
}

function isUntimedValue(value: string | null): boolean {
  return Boolean(
    value && /^(?:tba|tbd|arr|arranged|arrange)$/iu.test(value.trim()),
  );
}

function parseClock(
  hourText: string,
  minuteText: string,
  amPm: string,
): string {
  let hour = Number(hourText);
  const minute = Number(minuteText);
  if (amPm.toLowerCase() === 'a' && hour === 12) hour = 0;
  if (amPm.toLowerCase() === 'p' && hour !== 12) hour += 12;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseTimeRange(rawTime: string | null): {
  start_time: string | null;
  end_time: string | null;
} {
  if (!rawTime || isUntimedValue(rawTime)) {
    return {
      start_time: null,
      end_time: null,
    };
  }
  const match =
    /^(?<startHour>\d{1,2}):(?<startMinute>\d{2})\s*(?<startAmPm>[ap])\s*-\s*(?<endHour>\d{1,2}):(?<endMinute>\d{2})\s*(?<endAmPm>[ap])$/iu.exec(
      rawTime.trim(),
    );
  if (!match) {
    return {
      start_time: null,
      end_time: null,
    };
  }
  const groups = match.groups!;
  return {
    start_time: parseClock(
      groups.startHour!,
      groups.startMinute!,
      groups.startAmPm!,
    ),
    end_time: parseClock(groups.endHour!, groups.endMinute!, groups.endAmPm!),
  };
}

function parseMeetingDate(rawDate: string | null): string | null {
  if (!rawDate) return null;
  const match = /^(?<month>\d{1,2})\/(?<day>\d{1,2})\/(?<year>\d{4})$/u.exec(
    rawDate.trim(),
  );
  if (!match?.groups) return null;
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const year = Number(match.groups.year);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function locationPart(value: string | null): string | null {
  if (!value || isUntimedValue(value)) return null;
  return value;
}

function rawLocation(
  rawBuilding: string | null,
  rawRoom: string | null,
): string | null {
  const values = [rawBuilding, rawRoom].filter((value): value is string =>
    Boolean(value),
  );
  if (!values.length) return null;
  if (values.every((value) => value === values[0])) return values[0]!;
  return values.join(' ');
}

function parseMeeting(cells: Cell[]): SnapshotMeeting {
  const type = meetingType(cells[3]!);
  const date = parseMeetingDate(nullIfBlank(cells[4]?.text ?? ''));
  const rawDays = nullIfBlank(cells[5]?.text ?? '');
  const rawTime = nullIfBlank(cells[6]?.text ?? '');
  const rawBuilding = nullIfBlank(cells[7]?.text ?? '');
  const rawRoom = nullIfBlank(cells[8]?.text ?? '');
  const times = parseTimeRange(rawTime);
  const explicitlyUntimed =
    isUntimedValue(rawDays) ||
    isUntimedValue(rawTime) ||
    isUntimedValue(rawBuilding) ||
    isUntimedValue(rawRoom);

  return {
    days: parseDays(rawDays),
    date,
    start_time: times.start_time,
    end_time: times.end_time,
    building: locationPart(rawBuilding),
    room: locationPart(rawRoom),
    is_tba: explicitlyUntimed,
    meeting_type: type,
    raw_days: rawDays,
    raw_time: rawTime,
    raw_location: rawLocation(rawBuilding, rawRoom),
  };
}

function parseAvailability(
  availableCell: Cell | undefined,
  limitCell: Cell | undefined,
): {
  enrolled: number | null;
  capacity: number | null;
  waitlist_count: number;
} {
  const limitText = limitCell?.text.trim() ?? '';
  const availableText = availableCell?.text.trim() ?? '';
  const capacity = /^\d+$/u.test(limitText) ? Number(limitText) : null;

  if (/full/iu.test(availableText)) {
    const waitlistMatch = /waitlist\s*\(\s*(?<count>\d+)\s*\)/iu.exec(
      availableText,
    );
    return {
      enrolled: capacity,
      capacity,
      waitlist_count: waitlistMatch ? Number(waitlistMatch.groups!.count) : 0,
    };
  }

  if (/^\d+$/u.test(availableText) && capacity !== null) {
    return {
      enrolled: Math.max(0, capacity - Number(availableText)),
      capacity,
      waitlist_count: 0,
    };
  }

  return { enrolled: null, capacity: null, waitlist_count: 0 };
}

function parseInstructors(cell: Cell): string[] {
  const linkedNames = tagContents(cell.html, 'a')
    .map(normalizeText)
    .filter(Boolean);
  if (linkedNames.length) return [...new Set(linkedNames)];
  const text = normalizeText(cell.html);
  return text ? [text] : [];
}

function mergeUnique(values: string[], additions: string[]): string[] {
  const merged = [...values];
  for (const addition of additions)
    if (!merged.includes(addition)) merged.push(addition);

  return merged;
}

function cloneMeeting(meeting: SnapshotMeeting): SnapshotMeeting {
  return {
    ...meeting,
    days: [...meeting.days],
  };
}

function appendSharedMeetingToSections(
  course: SnapshotCourse,
  family: string,
  meeting: SnapshotMeeting,
  instructors: string[],
): number {
  const targetSections = family
    ? course.sections.filter(
        (section) => sectionFamily(section.section_code) === family,
      )
    : course.sections;

  for (const section of targetSections) {
    section.meetings.push(cloneMeeting(meeting));
    section.instructors = mergeUnique(section.instructors, instructors);
  }

  return targetSections.length;
}

function sectionRaw(
  options: ParseOptions,
  course: SnapshotCourse,
  cells: Cell[],
) {
  return {
    source: 'ucsd_schedule_of_classes',
    source_url: options.sourceUrl,
    fetched_at: options.fetchedAt,
    raw_term: options.term,
    raw_subject: options.subject,
    raw_course_number: course.course_number,
    raw_section_identifier: cells[2]?.text ?? '',
    raw_section_code: cells[4]?.text ?? '',
    raw_meeting_type: rawMeetingType(cells[3]!) ?? '',
  };
}

export function parseScheduleOfClassesHtml(
  html: string,
  options: ParseOptions,
): ParsedScheduleOfClasses {
  const coursesById = new Map<string, SnapshotCourse>();
  const sectionLookup = new Map<string, SnapshotSection>();
  const pendingSharedMeetings = new Map<
    string,
    { meetings: SnapshotMeeting[]; instructors: string[] }
  >();
  let currentCourse: SnapshotCourse | null = null;
  let currentFamily = '';

  for (const rowMatch of html.matchAll(
    /<tr\b[^>]*>(?<html>[\s\S]*?)<\/tr>/giu,
  )) {
    const rowHtml = rowMatch.groups?.html ?? '';
    const cells = extractCells(rowHtml);
    if (!cells.length) continue;

    const courseHeader = parseCourseHeader(cells, options.subject);
    if (courseHeader) {
      currentCourse = coursesById.get(courseHeader.course_id) ?? courseHeader;
      if (!coursesById.has(courseHeader.course_id))
        coursesById.set(courseHeader.course_id, currentCourse);
      pendingSharedMeetings.clear();
      currentFamily = '';
      continue;
    }

    if (
      !classNameMatches(rowMatch[0], 'sectxt') &&
      !classNameMatches(rowMatch[0], 'nonenrtxt')
    )
      continue;
    const logicalCells = expandedCells(cells);
    if (!hasMeetingTypeMarker(logicalCells[3])) continue;
    if (!currentCourse) {
      throw new Error(
        `Schedule section row found before course header for ${options.subject}`,
      );
    }

    const sourceSectionId = logicalCells[2]?.text ?? '';
    const sectionCode = nullIfBlank(logicalCells[4]?.text ?? '');
    const explicitFamily = sectionFamily(sectionCode);
    const family = sourceSectionId
      ? explicitFamily
      : explicitFamily || currentFamily;
    if (explicitFamily) currentFamily = explicitFamily;
    const meeting = parseMeeting(logicalCells);
    const instructors = parseInstructors(
      logicalCells[9] ?? { html: '', text: '', colSpan: 1 },
    );

    if (!sourceSectionId) {
      const attachedCount = appendSharedMeetingToSections(
        currentCourse,
        family,
        meeting,
        instructors,
      );

      if (family || attachedCount === 0) {
        const pendingShared = pendingSharedMeetings.get(family) ?? {
          meetings: [],
          instructors: [],
        };
        pendingShared.meetings.push(meeting);
        pendingShared.instructors = mergeUnique(
          pendingShared.instructors,
          instructors,
        );
        pendingSharedMeetings.set(family, pendingShared);
      }
      continue;
    }

    const sectionKey = `${currentCourse.course_id}:${sourceSectionId}`;
    const existingSection = sectionLookup.get(sectionKey);
    if (existingSection) {
      existingSection.meetings.push(meeting);
      existingSection.instructors = mergeUnique(
        existingSection.instructors,
        instructors,
      );
      continue;
    }

    const pending = pendingSharedMeetings.get(family);
    const availability = parseAvailability(logicalCells[10], logicalCells[11]);
    const section: SnapshotSection = {
      section_id: `${options.term}:${sourceSectionId}`,
      course_id: currentCourse.course_id,
      section_code: sectionCode,
      meeting_type: meetingType(logicalCells[3]!),
      instructors: mergeUnique(pending?.instructors ?? [], instructors),
      meetings: [...(pending?.meetings ?? []).map(cloneMeeting), meeting],
      enrolled: availability.enrolled,
      capacity: availability.capacity,
      waitlist_count: availability.waitlist_count,
      raw: sectionRaw(options, currentCourse, logicalCells),
    };
    currentCourse.sections.push(section);
    sectionLookup.set(sectionKey, section);
  }

  return {
    subject: normalizeSubject(options.subject),
    term: options.term,
    source_url: options.sourceUrl,
    fetched_at: options.fetchedAt,
    source_timestamp: parseSourceTimestamp(html),
    courses: [...coursesById.values()],
  };
}

function scheduleSearchBody(
  term: string,
  subjectCode: string,
): URLSearchParams {
  const body = new URLSearchParams({
    selectedTerm: term,
    xsoc_term: '',
    loggedIn: 'false',
    tabNum: 'tabs-sub',
    _selectedSubjects: '1',
    _schDay: 'on',
    _hideFullSec: 'on',
    _showPopup: 'on',
  });
  body.append('selectedSubjects', subjectCode);
  for (const field of courseOptionFields) {
    body.append(field, 'true');
    body.append(`_${field}`, 'on');
  }
  return body;
}

function responseCookieHeader(headers: Headers): string {
  const headerAccess = headers as Headers & { getSetCookie: () => string[] };
  const cookieHeaders = Object.hasOwn(headerAccess, 'getSetCookie')
    ? headerAccess.getSetCookie()
    : [];
  const rawCookies =
    cookieHeaders.length > 0
      ? cookieHeaders
      : [headers.get('set-cookie') ?? ''];

  return rawCookies
    .flatMap(splitSetCookieHeader)
    .map((value) => value.trim().split(';')[0]?.trim() ?? '')
    .filter(Boolean)
    .join('; ');
}

function splitSetCookieHeader(value: string): string[] {
  const parts: string[] = [];
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== ',') continue;

    const rest = value.slice(index + 1).trimStart();
    const equalsIndex = rest.indexOf('=');
    const semicolonIndex = rest.indexOf(';');
    const commaIndex = rest.indexOf(',');
    const looksLikeNextCookie =
      equalsIndex > 0 &&
      (semicolonIndex === -1 || equalsIndex < semicolonIndex) &&
      (commaIndex === -1 || equalsIndex < commaIndex);
    if (!looksLikeNextCookie) continue;

    parts.push(value.slice(start, index));
    start = index + 1;
  }

  parts.push(value.slice(start));
  return parts;
}

function schedulePageUrl(page: number): string {
  return `${scheduleResultUrl}?page=${page}`;
}

function scheduleResultPageCount(html: string): number {
  const decoded = decodeHtml(html);
  const pageTextMatch = /page\s*\(\s*\d+\s+of\s+(?<count>\d+)\s*\)/iu.exec(
    decoded,
  );
  const textCount = Number(pageTextMatch?.groups?.count ?? '1');
  const linkedPages = [...decoded.matchAll(/[?&]page=(?<page>\d+)/giu)]
    .map((match) => Number(match.groups?.page ?? '1'))
    .filter((page) => Number.isFinite(page) && page > 0);
  return Math.max(1, textCount, ...linkedPages);
}

async function fetchScheduleResultPage(
  fetchAdapter: FetchAdapter,
  page: number,
  cookieHeader: string,
): Promise<string> {
  const headers: HeadersInit = {};
  if (cookieHeader) headers.Cookie = cookieHeader;
  const response = await fetchAdapter(schedulePageUrl(page), { headers });
  if (!response.ok) {
    throw new Error(
      `UCSD Schedule page ${page} query failed: ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
}

function subjectListUrl(term: string): string {
  return `${scheduleBaseUrl}/subject-list.json?selectedTerm=${encodeURIComponent(term)}`;
}

function parseSubjectListRaw(raw: string, term: string) {
  try {
    return parseSubjectListData(JSON.parse(raw) as unknown, term);
  } catch {
    throw new Error(`UCSD Schedule subject list is invalid for ${term}`);
  }
}

function parseSubjectListData(data: unknown, term: string) {
  if (!Array.isArray(data))
    throw new Error(`UCSD Schedule subject list is invalid for ${term}`);

  return data.map((item) => {
    if (!item || typeof item !== 'object') {
      return {
        code: '',
        value: '',
      };
    }
    const record = item as { code?: unknown; value?: unknown };
    return {
      code: typeof record.code === 'string' ? record.code : '',
      value: typeof record.value === 'string' ? record.value : '',
    };
  });
}

export async function fetchSubjectListSource(
  term: string,
  options: { fetch?: FetchAdapter } = {},
): Promise<SubjectListSource> {
  const fetchAdapter = options.fetch ?? fetch;
  const url = subjectListUrl(term);
  const response = await fetchAdapter(url);
  if (!response.ok) {
    throw new Error(
      `UCSD Schedule subject list failed for ${term}: ${response.status} ${response.statusText}`,
    );
  }
  const raw = await response.text();
  return {
    url,
    raw,
    subjects: parseSubjectListRaw(raw, term),
  };
}

export async function fetchSubjectListCodes(
  term: string,
  options: { fetch?: FetchAdapter } = {},
): Promise<string[]> {
  const source = await fetchSubjectListSource(term, options);
  return source.subjects
    .map((entry) => entry.code.trim())
    .filter((code) => code.length > 0);
}

export async function fetchRawScheduleOfClassesForSubject(
  subject: string,
  options: FetchOptions,
): Promise<RawScheduleOfClassesSource> {
  const fetchAdapter = options.fetch ?? fetch;
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  const subjectList =
    options.subjectList ??
    (await fetchSubjectListSource(options.term, { fetch: fetchAdapter }));
  const subjectEntry = subjectList.subjects.find(
    (item) => normalizeSubject(item.code) === normalizeSubject(subject),
  );
  if (!subjectEntry) {
    throw new Error(
      `UCSD Schedule subject ${subject} is not available for term ${options.term}`,
    );
  }

  const response = await fetchAdapter(scheduleResultUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: scheduleSearchBody(options.term, subjectEntry.code),
  });
  if (!response.ok) {
    throw new Error(
      `UCSD Schedule query failed for ${subject} ${options.term}: ${response.status} ${response.statusText}`,
    );
  }
  const firstPageHtml = await response.text();
  const pageCount = scheduleResultPageCount(firstPageHtml);
  const cookieHeader = responseCookieHeader(response.headers);
  const htmlPages = [firstPageHtml];
  for (let page = 2; page <= pageCount; page += 1) {
    htmlPages.push(
      await fetchScheduleResultPage(fetchAdapter, page, cookieHeader),
    );
  }

  return {
    subject: normalizeSubject(subject),
    term: options.term,
    fetched_at: fetchedAt,
    subject_list_url: subjectList.url,
    subject_list_raw: subjectList.raw,
    source_url: scheduleResultUrl,
    html: htmlPages.join('\n'),
  };
}

export async function fetchScheduleOfClassesForSubject(
  subject: string,
  options: FetchOptions,
): Promise<ParsedScheduleOfClasses> {
  const rawSource = await fetchRawScheduleOfClassesForSubject(subject, options);
  const parsed = parseScheduleOfClassesHtml(rawSource.html, {
    subject,
    term: options.term,
    sourceUrl: rawSource.source_url,
    fetchedAt: rawSource.fetched_at,
  });
  if (!parsed.courses.length) {
    throw new Error(
      `UCSD Schedule returned no courses for ${subject} ${options.term}`,
    );
  }
  return parsed;
}

export async function fetchScheduleOfClassesForSubjects(
  subjects: string[],
  options: FetchOptions,
): Promise<ParsedScheduleOfClasses[]> {
  const parsed: ParsedScheduleOfClasses[] = [];
  for (const subject of subjects)
    parsed.push(await fetchScheduleOfClassesForSubject(subject, options));

  return parsed;
}

export function buildScheduleCatalogSnapshot(
  config: CatalogSnapshotConfig,
  parsedSubjects: ParsedScheduleOfClasses[],
  options: {
    runId?: string;
    generatedAt?: string;
  } = {},
): CatalogSnapshot {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runId = options.runId ?? `schedule-${generatedAt}`;
  const coursesById = new Map<string, SnapshotCourse>();

  for (const parsed of parsedSubjects) {
    for (const course of parsed.courses) {
      const existing = coursesById.get(course.course_id);
      if (existing) {
        existing.sections.push(...course.sections);
      } else {
        coursesById.set(course.course_id, {
          ...course,
          sections: [...course.sections],
        });
      }
    }
  }

  return {
    run_id: runId,
    generated_at: generatedAt,
    active_planning_term: config.active_planning_term,
    term_label: config.term_label,
    term_date_range: config.term_date_range,
    configured_subjects: config.configured_subjects,
    source_timestamps: {
      schedule_of_classes:
        parsedSubjects.find((parsed) => parsed.source_timestamp)
          ?.source_timestamp ?? generatedAt,
      general_catalog: null,
      instructor_grade_archive: null,
    },
    courses: [...coursesById.values()],
  };
}
