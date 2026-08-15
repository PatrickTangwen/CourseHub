import { z } from 'zod';

export type TssAvailabilitySupplementRecord = {
  subject: string;
  course: string;
  sectionCode: string;
  capacity: number | null;
  enrolled: number | null;
  availableSeats: number | null;
  capacityKind: 'bounded' | 'effectively_unbounded';
  reportedCapacity: number;
  reportedAvailableSeats: number;
  status: 'active' | 'unknown';
  line: number;
};

type SupplementHeader = {
  delimiter: ',' | '\t';
  subject: number;
  course: number;
  section: number;
  capacity: number;
  enrolled: number | null;
  available: number;
  status: number | null;
};

const enrollmentSchema = z
  .object({
    enrolled: z.number().nullable(),
    capacity: z.number().nullable(),
    seats_available: z.number().nullable(),
  })
  .passthrough();

const supplementResponseSchema = z
  .object({
    courses: z.array(
      z
        .object({
          course_code: z.string().min(1),
          tss_course_code: z.string().min(1),
          booking_choices: z.array(
            z
              .object({
                components: z.array(
                  z
                    .object({
                      section_code: z.string().min(1),
                      enrollment: enrollmentSchema,
                    })
                    .passthrough(),
                ),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function normalizeCharacters(value: string): string {
  return value
    .replace(/[\u2010-\u2013\u2212]/gu, '-')
    .replace(/[\u00a0\u202f]/gu, ' ');
}

function parseDelimitedLine(line: string, delimiter: ',' | '\t'): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      values.push(value.trim());
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

function canonicalHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z\d]+/gu, '');
}

function headerIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

function parseHeader(line: string): SupplementHeader | null {
  const delimiter = line.includes('\t') ? '\t' : ',';
  const headers = parseDelimitedLine(line, delimiter).map(canonicalHeader);
  if (headers[0] !== 'subject') return null;
  const subject = headerIndex(headers, ['subject']);
  const course = headerIndex(headers, ['course']);
  const section = headerIndex(headers, ['section', 'sectioncode']);
  const capacity = headerIndex(headers, [
    'seatstotal',
    'enrollmentlimit',
    'limit',
  ]);
  const enrolled = headerIndex(headers, ['enrolled']);
  const available = headerIndex(headers, ['seatsavailable', 'availableseats']);
  const status = headerIndex(headers, ['status']);
  if (
    [subject, course, section, capacity, available].some((index) => index < 0)
  )
    throw new Error(`Unsupported TSS availability supplement header: ${line}`);
  return {
    delimiter,
    subject,
    course,
    section,
    capacity,
    enrolled: enrolled < 0 ? null : enrolled,
    available,
    status: status < 0 ? null : status,
  };
}

function isAnnotationLine(line: string, delimiter: ',' | '\t'): boolean {
  if (/^notes?:?$/iu.test(line) || line.startsWith('•')) return true;
  if (
    /^(?:seats available|enrollment limit|waitlist|all sections listed|numbers such as)\b/iu.test(
      line,
    )
  )
    return true;
  const values = parseDelimitedLine(line, delimiter);
  return (
    values.length > 1 &&
    values.every((value) => /^(?:…|\.\.\.)$/u.test(value.trim()))
  );
}

function normalizeCourse(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/^0+(?=\d)/u, '');
}

function normalizeSection(value: string): string {
  return normalizeCharacters(value).trim().toUpperCase().replace(/\s+/gu, '');
}

function parseCount(value: string | undefined, line: number, field: string) {
  const normalized = value?.trim().replace(/\s+/gu, '') ?? '';
  if (!/^\d+$/u.test(normalized))
    throw new Error(`line ${line} has invalid ${field}: ${value ?? ''}`);
  return Number(normalized);
}

function parseStatus(
  value: string | undefined,
  line: number,
): 'active' | 'unknown' {
  const status = value?.trim().toUpperCase() ?? '';
  if (!status) return 'unknown';
  if (status === 'AC' || status === 'ACTIVE') return 'active';
  throw new Error(`line ${line} has unsupported status: ${status}`);
}

function isEffectivelyUnbounded(value: number): boolean {
  return value === 9999 || value === 99999;
}

function supplementKey(subject: string, course: string, sectionCode: string) {
  return `${subject}:${course}:${sectionCode}`;
}

export function parseTssAvailabilitySupplement(
  contents: string,
): TssAvailabilitySupplementRecord[] {
  const records: TssAvailabilitySupplementRecord[] = [];
  const keys = new Set<string>();
  let header: SupplementHeader | null = null;
  const lines = contents.split(/\r?\n/u);

  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    const line = normalizeCharacters(rawLine).trim();
    if (!line) continue;
    const nextHeader = parseHeader(line);
    if (nextHeader) {
      header = nextHeader;
      continue;
    }
    if (!header) continue;

    if (isAnnotationLine(line, header.delimiter)) continue;

    const values = parseDelimitedLine(line, header.delimiter);
    const lastRequiredIndex = Math.max(
      header.subject,
      header.course,
      header.section,
      header.capacity,
      header.available,
    );
    if (values.length <= lastRequiredIndex) {
      throw new Error(
        `line ${lineNumber} has ${values.length} columns; expected at least ${lastRequiredIndex + 1}`,
      );
    }
    const subject = values[header.subject]?.trim().toUpperCase() ?? '';
    if (!/^[A-Z][A-Z\d]{1,7}$/u.test(subject))
      throw new Error(`line ${lineNumber} has invalid subject: ${subject}`);
    const course = normalizeCourse(values[header.course] ?? '');
    const sectionCode = normalizeSection(values[header.section] ?? '');
    const reportedCapacity = parseCount(
      values[header.capacity],
      lineNumber,
      'capacity',
    );
    const reportedAvailableSeats = parseCount(
      values[header.available],
      lineNumber,
      'available seats',
    );
    const enrolled =
      header.enrolled === null || !values[header.enrolled]?.trim()
        ? null
        : parseCount(values[header.enrolled], lineNumber, 'enrolled');
    const capacityKind =
      isEffectivelyUnbounded(reportedCapacity) ||
      isEffectivelyUnbounded(reportedAvailableSeats)
        ? 'effectively_unbounded'
        : 'bounded';
    if (capacityKind === 'bounded' && reportedAvailableSeats > reportedCapacity)
      throw new Error(`line ${lineNumber} available seats exceed capacity`);
    const status = parseStatus(
      header.status === null ? undefined : values[header.status],
      lineNumber,
    );
    const key = supplementKey(subject, course, sectionCode);
    if (keys.has(key))
      throw new Error(`line ${lineNumber} duplicates supplement record ${key}`);
    keys.add(key);
    records.push({
      subject,
      course,
      sectionCode,
      capacity: capacityKind === 'bounded' ? reportedCapacity : null,
      enrolled,
      availableSeats:
        capacityKind === 'bounded' ? reportedAvailableSeats : null,
      capacityKind,
      reportedCapacity,
      reportedAvailableSeats,
      status,
      line: lineNumber,
    });
  }

  if (records.length === 0)
    throw new Error('TSS availability supplement contains no records');
  return records;
}

function recordOverride(
  current: number | null,
  next: number | null,
  field: string,
  record: TssAvailabilitySupplementRecord,
  overrides: {
    key: string;
    field: string;
    current: number;
    next: number | null;
    line: number;
  }[],
) {
  if (current !== null && current !== next) {
    overrides.push({
      key: supplementKey(record.subject, record.course, record.sectionCode),
      field,
      current,
      next,
      line: record.line,
    });
  }
}

export function applyTssAvailabilitySupplement(
  responses: unknown[],
  records: TssAvailabilitySupplementRecord[],
) {
  const recordsByKey = new Map(
    records.map((record) => [
      supplementKey(record.subject, record.course, record.sectionCode),
      record,
    ]),
  );
  const matchedKeys = new Set<string>();
  const overrides: {
    key: string;
    field: string;
    current: number;
    next: number | null;
    line: number;
  }[] = [];
  let updatedComponents = 0;
  const enrichedResponses = responses.map((response) => {
    const parsed = supplementResponseSchema.parse(response);
    return {
      ...parsed,
      courses: parsed.courses.map((course) => {
        const subject = course.tss_course_code
          .split('-', 1)[0]!
          .trim()
          .toUpperCase();
        const courseNumber = normalizeCourse(course.course_code);
        return {
          ...course,
          booking_choices: course.booking_choices.map((choice) => ({
            ...choice,
            components: choice.components.map((component) => {
              const sectionCode = normalizeSection(component.section_code);
              const key = supplementKey(subject, courseNumber, sectionCode);
              const record = recordsByKey.get(key);
              if (!record) return component;
              const currentEnrolled = component.enrollment.enrolled;
              const enrolled =
                record.enrolled ??
                (currentEnrolled === 9999 || currentEnrolled === 99999
                  ? null
                  : currentEnrolled);
              recordOverride(
                component.enrollment.capacity,
                record.capacity,
                'capacity',
                record,
                overrides,
              );
              recordOverride(
                component.enrollment.enrolled,
                enrolled,
                'enrolled',
                record,
                overrides,
              );
              recordOverride(
                component.enrollment.seats_available,
                record.availableSeats,
                'available seats',
                record,
                overrides,
              );
              matchedKeys.add(key);
              updatedComponents += 1;
              return {
                ...component,
                enrollment: {
                  ...component.enrollment,
                  capacity: record.capacity,
                  enrolled,
                  seats_available: record.availableSeats,
                  capacity_kind: record.capacityKind,
                  reported_capacity:
                    record.capacityKind === 'effectively_unbounded'
                      ? record.reportedCapacity
                      : null,
                  reported_seats_available:
                    record.capacityKind === 'effectively_unbounded'
                      ? record.reportedAvailableSeats
                      : null,
                },
              };
            }),
          })),
        };
      }),
    };
  });
  const unmatched = records.filter(
    (record) =>
      !matchedKeys.has(
        supplementKey(record.subject, record.course, record.sectionCode),
      ),
  );
  return {
    responses: enrichedResponses,
    records: records.length,
    matchedRecords: matchedKeys.size,
    updatedComponents,
    overriddenValues: overrides.length,
    overrides,
    unmatchedRecords: unmatched.length,
    unmatchedKeys: unmatched.map((record) =>
      supplementKey(record.subject, record.course, record.sectionCode),
    ),
  };
}
