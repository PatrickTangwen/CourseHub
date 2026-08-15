import { tssLocationDisplay } from '../../shared/tssMeetingDays.js';

const legacyHeader = [
  'term_code',
  'subject_code',
  'course_code',
  'class_name',
  'course_title',
  'academic_level',
  'section_id',
  'section_ref',
  'section_code',
  'instruction_type_name',
  'instructors_text',
  'seats_available',
  'waitlist_available',
  'meeting_kind',
  'day_code',
  'day_name',
  'specific_date',
  'start_time_display',
  'end_time_display',
  'building_code',
  'room_code',
  'is_remote',
  'is_tba',
] as const;

const normalizedColumns = [
  ...legacyHeader,
  'module_code',
  'capacity',
  'enrolled',
  'waitlist_capacity',
  'waitlist_enrolled',
  'status',
  'is_cancelled',
] as const;

type Column = (typeof normalizedColumns)[number];
type CsvRow = { [column in Column]: string } & {
  chunk: number;
  line: number;
  componentKey?: string;
};

export type TritonGptCsvConversionOptions = {
  capturedAt: string;
  expectedSubjects?: string[];
  stablePackageIds?: { [packageIdentity: string]: string };
};

const naturalCollator = new Intl.Collator('en-US', {
  numeric: true,
  sensitivity: 'base',
});

function sourceIdentifier(value: string) {
  return value.trim().replace(/\s+/gu, '');
}

export function tritonGptPackageIdentity(
  tssCourseCode: string,
  eventIds: string[],
) {
  return `${sourceIdentifier(tssCourseCode)}:${eventIds
    .map(sourceIdentifier)
    .sort(naturalCollator.compare)
    .join('+')}`;
}

export function tritonGptSectionCodePackageIdentity(
  tssCourseCode: string,
  sectionCodes: string[],
) {
  return `sections:${sourceIdentifier(tssCourseCode)}:${sectionCodes
    .map(sourceIdentifier)
    .sort(naturalCollator.compare)
    .join('+')}`;
}

const sectionTypeBySuffix: { [key: string]: string } = {
  CL: 'cl',
  CO: 'co',
  DI: 'discussion',
  FW: 'fw',
  IN: 'in',
  IT: 'it',
  LA: 'lab',
  LE: 'lecture',
  OT: 'ot',
  PR: 'pr',
  SE: 'se',
  ST: 'studio',
  TU: 'tu',
};

function uniqueSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort(naturalCollator.compare);
}

function parseInteger(value: string) {
  if (!value) return null;
  if (!/^\d+$/u.test(value))
    throw new Error(`Expected an integer, got ${value}`);
  return Number(value);
}

function parseBoolean(value: string, field: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || ['0', 'false', 'no', 'n'].includes(normalized))
    return false;
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  throw new Error(`Expected a boolean ${field}, got ${value}`);
}

class UnsupportedStatusError extends Error {}

function parseStatus(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return '';
  if (normalized === 'AC' || normalized === 'ACTIVE') return 'AC';
  throw new UnsupportedStatusError(`unsupported status: ${value}`);
}

function parseCsvCells(line: string) {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error('row has an unterminated quoted field');
  cells.push(cell);
  return cells;
}

function canonicalHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, '_');
}

function academicLevelIndex(tokens: string[]) {
  return tokens.findIndex(
    (token, index) =>
      index >= 4 &&
      ['LD', 'UD', 'GR'].includes(token) &&
      /^(?:E\s+\d+|EL\d+)$/u.test(tokens[index + 1] ?? ''),
  );
}

function parseLegacyLine(
  line: string,
  chunk: number,
  lineNumber: number,
): CsvRow {
  const tokens = line.split(',');
  const levelIndex = academicLevelIndex(tokens);
  const meetingIndex = tokens.length - 10;
  if (
    levelIndex < 4 ||
    meetingIndex < levelIndex + 5 ||
    !['0', '1'].includes(tokens.at(-2) ?? '') ||
    !['0', '1'].includes(tokens.at(-1) ?? '')
  ) {
    throw new Error(
      'row is truncated or does not contain the fixed meeting tail',
    );
  }

  const middle = tokens.slice(levelIndex + 5, meetingIndex);
  let instructors = '';
  let seats = '';
  let waitlist = '';
  if (middle.length >= 3) {
    instructors = middle.slice(0, -2).join(',');
    seats = middle.at(-2) ?? '';
    waitlist = middle.at(-1) ?? '';
  } else if (middle.length === 2) {
    seats = middle[0] ?? '';
    waitlist = middle[1] ?? '';
  } else if (middle.length === 1) {
    instructors = middle[0] ?? '';
  } else {
    throw new Error('row has no instructor or availability fields');
  }

  const values = [
    ...tokens.slice(0, 4),
    tokens.slice(4, levelIndex).join(','),
    ...tokens.slice(levelIndex, levelIndex + 5),
    instructors,
    seats,
    waitlist,
    ...tokens.slice(meetingIndex),
  ];
  if (values.length !== legacyHeader.length)
    throw new Error(`row expanded to ${values.length} columns`);
  return normalizeRow(
    Object.fromEntries(
      legacyHeader.map((name, index) => [name, values[index] ?? '']),
    ),
    chunk,
    lineNumber,
  );
}

function courseParts(row: { [key: string]: string }) {
  const directSubject = row.subject_code?.trim().toUpperCase();
  const directCourse = row.course_code?.trim().toUpperCase();
  if (directSubject && directCourse)
    return { subject: directSubject, course: directCourse };

  const moduleCode = row.module_code?.trim() ?? '';
  const match =
    /^(?<subject>[a-z][a-z\d]{1,7})[-:\s]+(?<course>\d[a-z\d-]*)$/iu.exec(
      moduleCode,
    );
  const subject = match?.groups?.subject?.toUpperCase();
  const course = match?.groups?.course?.toUpperCase();
  if (!subject || !course) {
    throw new Error(
      'row requires subject_code + course_code or a parseable module_code',
    );
  }
  return { subject, course };
}

function normalizeRow(
  raw: { [key: string]: string },
  chunk: number,
  line: number,
): CsvRow {
  const row = Object.fromEntries(
    normalizedColumns.map((column) => [column, raw[column]?.trim() ?? '']),
  ) as { [column in Column]: string };
  const { subject, course } = courseParts(row);
  row.subject_code = subject;
  row.course_code = course;
  row.module_code ||= `${subject}-${course}`;
  if (!row.term_code) throw new Error('row has no term_code');
  if (!row.section_code) throw new Error('row has no section_code');
  row.is_remote = String(parseBoolean(row.is_remote, 'is_remote'));
  row.is_tba = String(parseBoolean(row.is_tba, 'is_tba'));
  const cancellationValue = row.is_cancelled.trim();
  const isCancelled = cancellationValue
    ? parseBoolean(cancellationValue, 'is_cancelled')
    : null;
  row.is_cancelled = isCancelled === null ? '' : String(isCancelled);
  row.status = row.status.trim().toUpperCase();
  return { ...row, chunk, line };
}

function parseLine(
  line: string,
  headers: string[],
  chunk: number,
  lineNumber: number,
): CsvRow {
  const cells = parseCsvCells(line);
  if (cells.length !== headers.length) {
    if (headers.join(',') === legacyHeader.join(','))
      return parseLegacyLine(line, chunk, lineNumber);
    throw new Error(
      `row has ${cells.length} columns but header has ${headers.length}`,
    );
  }
  return normalizeRow(
    Object.fromEntries(headers.map((header, index) => [header, cells[index]!])),
    chunk,
    lineNumber,
  );
}

function rowKey(row: CsvRow, columns: readonly Column[] = normalizedColumns) {
  return columns.map((column) => row[column]).join('\u001f');
}

function stableValue(rows: CsvRow[], column: Column) {
  const values = [...new Set(rows.map((row) => row[column]))].sort(
    naturalCollator.compare,
  );
  if (values.length !== 1) {
    throw new Error(
      `${rows[0]?.section_ref ?? 'section'} has conflicting ${column}: ${values.join(', ')}`,
    );
  }
  return values[0]!;
}

function optionalStableValue(rows: CsvRow[], column: Column) {
  const values = uniqueSorted(rows.map((row) => row[column]));
  if (values.length > 1) {
    throw new Error(
      `${rows[0]?.section_ref ?? 'section'} has conflicting ${column}: ${values.join(', ')}`,
    );
  }
  return values[0] ?? '';
}

function instructionType(row: CsvRow) {
  if (row.instruction_type_name) return row.instruction_type_name;
  const suffix = row.section_code.split('-').at(-1)?.toUpperCase() ?? '';
  return sectionTypeBySuffix[suffix] ?? 'other';
}

function location(row: CsvRow) {
  return tssLocationDisplay(
    row.building_code,
    row.room_code,
    row.is_remote === 'true',
  );
}

function toMeeting(row: CsvRow) {
  return {
    meeting_kind: row.meeting_kind,
    specific_date: row.specific_date || null,
    days: row.day_code || null,
    start_time: row.start_time_display || null,
    end_time: row.end_time_display || null,
    location_displayed: location(row),
    building: row.building_code || null,
    room: row.room_code || null,
    instructor: row.instructors_text || null,
    is_remote: row.is_remote === 'true',
    is_tba: row.is_tba === 'true',
    is_arranged: null,
  };
}

const meetingColumns = [
  'meeting_kind',
  'day_code',
  'day_name',
  'specific_date',
  'start_time_display',
  'end_time_display',
  'building_code',
  'room_code',
  'is_remote',
  'is_tba',
] as const;

function hasMeetingData(row: CsvRow) {
  return meetingColumns.some((column) => !['false', ''].includes(row[column]));
}

function sectionCodeKey(row: CsvRow) {
  return [
    row.term_code,
    row.subject_code,
    row.course_code,
    row.section_code,
  ].join('\u001f');
}

function sourceComponentId(row: CsvRow) {
  if (row.section_id) return sourceIdentifier(row.section_id);
  const termPrefix = `${row.term_code}:`;
  const sectionRef = row.section_ref.startsWith(termPrefix)
    ? row.section_ref.slice(termPrefix.length)
    : row.section_ref;
  return sourceIdentifier(sectionRef);
}

function resolveComponentKeys(rows: CsvRow[]) {
  for (const [baseKey, matchingRows] of groupBy(rows, sectionCodeKey)) {
    const sourceIds = uniqueSorted(matchingRows.map(sourceComponentId));
    const rowsWithoutSourceId = matchingRows.filter(
      (row) => !sourceComponentId(row),
    );
    if (sourceIds.length > 1 && rowsWithoutSourceId.length > 0) {
      throw new Error(
        `${matchingRows[0]!.section_code} has multiple source component ids; sparse rows cannot be matched safely`,
      );
    }
    for (const row of matchingRows) {
      const sourceId = sourceComponentId(row) || sourceIds[0];
      row.componentKey = sourceId ? `${baseKey}\u001f${sourceId}` : baseKey;
    }
  }
  return rows;
}

function sectionKey(row: CsvRow) {
  if (!row.componentKey) throw new Error('component identity was not resolved');
  return row.componentKey;
}

function courseKey(row: CsvRow) {
  return [row.subject_code, row.course_code].join('\u001f');
}

function sectionCoordinates(sectionCode: string) {
  const match = /^(?<classGroup>\d+)-(?<choiceGroup>\d+)-[A-Z]+$/u.exec(
    sectionCode,
  );
  const classGroup = match?.groups?.classGroup;
  const choiceGroup = match?.groups?.choiceGroup;
  if (!classGroup || !choiceGroup)
    throw new Error(`Unexpected TSS section code: ${sectionCode}`);
  return { classGroup, choiceGroup };
}

function groupBy<T>(values: T[], key: (value: T) => string) {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const group = groups.get(key(value));
    if (group) group.push(value);
    else groups.set(key(value), [value]);
  }
  return groups;
}

function parseChunks(chunks: string[]) {
  const rows: CsvRow[] = [];
  const malformedRows: {
    chunk: number;
    line: number;
    reason: string;
    raw: string;
  }[] = [];
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const lines = chunk.replace(/\r\n/gu, '\n').split('\n');
    if (lines.at(-1) === '') lines.pop();
    const headers = parseCsvCells(lines[0] ?? '').map(canonicalHeader);
    if (headers.length === 0 || headers.some((header) => !header))
      throw new Error(`Chunk ${chunkIndex + 1} has an invalid CSV header`);
    if (new Set(headers).size !== headers.length)
      throw new Error(`Chunk ${chunkIndex + 1} has duplicate CSV columns`);
    for (const [lineIndex, line] of lines.slice(1).entries()) {
      try {
        rows.push(parseLine(line, headers, chunkIndex + 1, lineIndex + 2));
      } catch (error) {
        if (error instanceof UnsupportedStatusError) throw error;
        malformedRows.push({
          chunk: chunkIndex + 1,
          line: lineIndex + 2,
          reason: error instanceof Error ? error.message : String(error),
          raw: line,
        });
      }
    }
  }
  return { rows, malformedRows };
}

function deduplicateRows(rows: CsvRow[]) {
  const unique = new Map(rows.map((row) => [rowKey(row), row]));
  return {
    rows: [...unique.values()],
    duplicatesRemoved: rows.length - unique.size,
  };
}

function toComponent(sectionRows: CsvRow[]) {
  for (const column of [
    'term_code',
    'subject_code',
    'course_code',
    'section_code',
  ] as const)
    stableValue(sectionRows, column);
  const sectionId = optionalStableValue(sectionRows, 'section_id');
  const sectionRef = optionalStableValue(sectionRows, 'section_ref');
  const instructors = optionalStableValue(sectionRows, 'instructors_text');
  const status = optionalStableValue(sectionRows, 'status');
  const enrolled = optionalStableValue(sectionRows, 'enrolled');
  const capacity = optionalStableValue(sectionRows, 'capacity');
  const seats = optionalStableValue(sectionRows, 'seats_available');
  const waitlistCapacity = optionalStableValue(
    sectionRows,
    'waitlist_capacity',
  );
  const waitlistEnrolled = optionalStableValue(
    sectionRows,
    'waitlist_enrolled',
  );
  const waitlist = optionalStableValue(sectionRows, 'waitlist_available');
  const parsedEnrolled = parseInteger(enrolled);
  const parsedCapacity = parseInteger(capacity);
  const parsedSeats = parseInteger(seats);
  const parsedWaitlistCapacity = parseInteger(waitlistCapacity);
  const parsedWaitlistEnrolled = parseInteger(waitlistEnrolled);
  const parsedWaitlist = parseInteger(waitlist);
  const sentinel = [parsedCapacity, parsedSeats].some(
    (value) => value === 9999 || value === 99999,
  );
  const meetings = [
    ...new Map(
      sectionRows
        .filter(hasMeetingData)
        .map((row) => [rowKey(row, meetingColumns), row]),
    ).values(),
  ].map(toMeeting);
  return {
    type: instructionType(sectionRows[0]!),
    section_code: sectionRows[0]!.section_code,
    event_id: sectionId || sectionRef || sectionRows[0]!.section_code,
    requirement: 'required',
    instructors_text: instructors || null,
    status: status || null,
    is_cancelled: false,
    meetings,
    enrollment: {
      enrolled: sentinel ? null : parsedEnrolled,
      capacity: sentinel ? null : parsedCapacity,
      seats_available: sentinel ? null : parsedSeats,
      ...(sentinel
        ? {
            capacity_kind: 'effectively_unbounded' as const,
            reported_capacity: parsedCapacity,
            reported_seats_available: parsedSeats,
          }
        : parsedCapacity !== null || parsedSeats !== null
          ? { capacity_kind: 'bounded' as const }
          : {}),
      waitlist: {
        state:
          waitlist || waitlistEnrolled || waitlistCapacity
            ? 'available_spots'
            : 'not_shown',
        count: parsedWaitlistEnrolled,
        ...(waitlistCapacity ? { capacity: parsedWaitlistCapacity } : {}),
        available_spots: parsedWaitlist,
      },
    },
  };
}

function toCourse(
  rows: CsvRow[],
  stablePackageIds: { [packageIdentity: string]: string },
) {
  const first = rows[0]!;
  const components = [...groupBy(rows, sectionKey).values()]
    .sort((a, b) =>
      naturalCollator.compare(a[0]!.section_code, b[0]!.section_code),
    )
    .map(toComponent);
  const componentGroups = groupBy(
    components,
    (component) => sectionCoordinates(component.section_code).classGroup,
  );
  const packages = [...componentGroups.values()].flatMap((classComponents) => {
    const choiceGroups = groupBy(
      classComponents,
      (component) => sectionCoordinates(component.section_code).choiceGroup,
    );
    const sharedComponents = choiceGroups.get('000') ?? [];
    const alternatives = [...choiceGroups.entries()]
      .filter(([choiceGroup]) => choiceGroup !== '000')
      .sort(([a], [b]) => naturalCollator.compare(a, b))
      .map(([, choiceComponents]) => choiceComponents);
    if (alternatives.length > 0) {
      return alternatives.map((choiceComponents) => [
        ...sharedComponents,
        ...choiceComponents,
      ]);
    }
    if (sharedComponents.length > 0) return [sharedComponents];
    return [...choiceGroups.values()];
  });
  const tssCourseCode = `${first.subject_code}-${first.course_code}`;
  const bookingChoices = packages.map((packageComponents, index) => {
    const stablePackageId = [
      tritonGptPackageIdentity(
        tssCourseCode,
        packageComponents.map((component) => component.event_id),
      ),
      tritonGptSectionCodePackageIdentity(
        tssCourseCode,
        packageComponents.map((component) => component.section_code),
      ),
    ].reduce<string | undefined>(
      (packageId, identity) => packageId ?? stablePackageIds[identity],
      undefined,
    );
    return {
      booking_choice_ordinal: index + 1,
      displayed_package_section: null,
      displayed_package_id:
        stablePackageId ??
        (packageComponents.length === 1
          ? packageComponents[0]!.event_id
          : null),
      components: packageComponents,
    };
  });
  return {
    course_code: first.course_code,
    course_title: optionalStableValue(rows, 'course_title') || null,
    tss_course_code: tssCourseCode,
    booking_choices: bookingChoices,
  };
}

export function convertTritonGptCsvChunks(
  chunks: string[],
  options: TritonGptCsvConversionOptions,
) {
  if (chunks.length === 0) throw new Error('No TritonGPT CSV chunks supplied');
  const parsed = parseChunks(chunks);
  const resolvedRows = resolveComponentKeys(parsed.rows);
  const cancelledSectionKeys = new Set(
    resolvedRows.filter((row) => row.is_cancelled === 'true').map(sectionKey),
  );
  const cancelledRows = resolvedRows.filter((row) =>
    cancelledSectionKeys.has(sectionKey(row)),
  );
  const publishableRows = resolvedRows
    .filter((row) => !cancelledSectionKeys.has(sectionKey(row)))
    .map((row) => ({ ...row, status: parseStatus(row.status) }));
  const deduplicated = deduplicateRows(publishableRows);
  const { rows } = deduplicated;
  const terms = uniqueSorted(parsed.rows.map((row) => row.term_code));
  if (terms.length !== 1)
    throw new Error(`Expected one term, got ${terms.join(', ')}`);
  const subjects = uniqueSorted(parsed.rows.map((row) => row.subject_code));
  const expectedSubjects = uniqueSorted(options.expectedSubjects ?? subjects);
  const subjectsWithoutRows = expectedSubjects.filter(
    (subject) => !subjects.includes(subject),
  );
  const omittedCourses = uniqueSorted(
    parsed.malformedRows.map(
      ({ raw }) => raw.split(',').slice(0, 4).at(-1) ?? '',
    ),
  );
  const complete =
    parsed.malformedRows.length === 0 && subjectsWithoutRows.length === 0;
  const courses = [...groupBy(rows, courseKey).values()]
    .map((courseRows) => toCourse(courseRows, options.stablePackageIds ?? {}))
    .sort((a, b) =>
      naturalCollator.compare(a.tss_course_code, b.tss_course_code),
    );
  const response = {
    schema_version: 'tss-chatbot-v1',
    term: terms[0]!,
    requested_course: expectedSubjects.join(', '),
    source_metadata: {
      last_refreshed_displayed: null,
      captured_at: options.capturedAt,
      availability_observed_at: options.capturedAt,
    },
    coverage: {
      complete,
      continuation_needed: !complete,
      ...(omittedCourses.length ? { omitted_courses: omittedCourses } : {}),
    },
    courses,
  };
  const report = {
    chunks: chunks.length,
    raw_rows: parsed.rows.length,
    exact_duplicates_removed: deduplicated.duplicatesRemoved,
    converted_rows: rows.length,
    cancelled_rows_excluded: cancelledRows.length,
    malformed_rows: parsed.malformedRows,
    subjects,
    expected_subjects_without_rows: subjectsWithoutRows,
    courses: courses.length,
    sections: courses.reduce(
      (count, course) => count + course.booking_choices.length,
      0,
    ),
    coverage: response.coverage,
  };
  return { response, report };
}
