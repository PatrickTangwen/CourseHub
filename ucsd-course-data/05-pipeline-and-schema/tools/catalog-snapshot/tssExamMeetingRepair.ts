type ExamKind = 'final' | 'midterm';

export type TssExamMeetingSource = {
  subject: string;
  courseNumber: string;
  sectionCode: string;
  eventId: string;
  kind: ExamKind;
  days: string;
  specificDate: string;
  startTime: string;
  endTime: string;
  location: string | null;
  instructor: string | null;
};

export type RawMeeting = {
  meeting_kind: string;
  specific_date: string | null;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  location_displayed: string | null;
  instructor: string | null;
  is_tba: boolean;
  is_arranged: boolean | null;
};

type RawComponent = {
  section_code: string;
  event_id: string;
  meetings: RawMeeting[];
};

type RawBookingChoice = {
  final_exam_date?: string | null;
  components: RawComponent[];
};

type RawTssResponse = {
  courses: {
    tss_course_code: string;
    booking_choices: RawBookingChoice[];
  }[];
};

function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      record.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      record.push(field);
      if (record.some((item) => item.length > 0)) records.push(record);
      record = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field);
    if (record.some((item) => item.length > 0)) records.push(record);
  }
  if (quoted) throw new Error('Unterminated quoted CSV field');
  return records;
}

function value(record: string[], index: number): string {
  return (record[index] ?? '').trim();
}

function examKind(input: string): ExamKind | null {
  const normalized = input.trim().toLowerCase();
  return normalized === 'final' || normalized === 'midterm' ? normalized : null;
}

function location(building: string, room: string): string | null {
  const normalizedRoom = room.trim();
  if (normalizedRoom && !/^tba$/iu.test(normalizedRoom)) return normalizedRoom;
  const normalizedBuilding = building.trim();
  if (normalizedBuilding && !/^tba$/iu.test(normalizedBuilding))
    return normalizedBuilding;
  return null;
}

function compactExam(record: string[]): TssExamMeetingSource | null {
  const kind = examKind(value(record, 8));
  if (!kind || record.length !== 17) return null;
  return {
    subject: value(record, 1),
    courseNumber: value(record, 2),
    sectionCode: value(record, 5),
    eventId: value(record, 7),
    kind,
    days: value(record, 9),
    specificDate: value(record, 10),
    startTime: value(record, 11),
    endTime: value(record, 12),
    location: location(value(record, 13), value(record, 14)),
    instructor: null,
  };
}

function expandedExam(record: string[]): TssExamMeetingSource | null {
  const kind = examKind(value(record, 5));
  if (!kind || (record.length !== 17 && record.length !== 18)) return null;
  return {
    subject: value(record, 0),
    courseNumber: value(record, 1),
    sectionCode: value(record, 2),
    eventId: value(record, 3),
    kind,
    days: value(record, 6),
    startTime: value(record, 7),
    endTime: value(record, 8),
    location: location(value(record, 9), value(record, 10)),
    instructor: value(record, 11) || null,
    specificDate: value(record, record.length - 1),
  };
}

function indexedExam(
  record: string[],
  header: string[],
): TssExamMeetingSource | null {
  if (record.length !== header.length) return null;
  const index = new Map(
    header.map((name, position) => [name.trim().toLowerCase(), position]),
  );
  const at = (name: string) => value(record, index.get(name) ?? -1);
  const kind = examKind(at('meeting_kind'));
  if (!kind) return null;
  return {
    subject: at('subject_code'),
    courseNumber: at('course_code'),
    sectionCode: at('section_code'),
    eventId: at('section_id'),
    kind,
    days: at('day_code'),
    specificDate: at('specific_date'),
    startTime: at('start_time_display'),
    endTime: at('end_time_display'),
    location: location(at('building_code'), at('room_code')),
    instructor: at('instructors_text') || null,
  };
}

function assertExam(record: TssExamMeetingSource, line: number): void {
  const required = [
    record.subject,
    record.courseNumber,
    record.sectionCode,
    record.eventId,
    record.days,
    record.specificDate,
    record.startTime,
    record.endTime,
  ];
  if (required.some((item) => !item))
    throw new Error(`Incomplete TSS exam row at CSV record ${line}`);
}

export function parseTssExamMeetings(text: string): TssExamMeetingSource[] {
  const [header, ...records] = parseCsv(text);
  if (!header) return [];
  return records.flatMap((record, index) => {
    const parsed =
      compactExam(record) ??
      expandedExam(record) ??
      indexedExam(record, header);
    if (!parsed) {
      const possibleKind = record.find((item) => examKind(item));
      if (possibleKind) {
        throw new Error(
          `Unrecognized TSS ${possibleKind} row at CSV record ${index + 2}`,
        );
      }
      return [];
    }
    assertExam(parsed, index + 2);
    return [parsed];
  });
}

function normalize(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/gu, ' ');
}

function sourceKey(source: TssExamMeetingSource): string {
  return [
    source.subject,
    source.courseNumber,
    source.sectionCode,
    source.eventId,
  ]
    .map(normalize)
    .join('|');
}

function componentKey(courseCode: string, component: RawComponent): string {
  const separator = courseCode.indexOf('-');
  const subject = separator < 0 ? courseCode : courseCode.slice(0, separator);
  const courseNumber =
    separator < 0 ? courseCode : courseCode.slice(separator + 1);
  return [subject, courseNumber, component.section_code, component.event_id]
    .map(normalize)
    .join('|');
}

function representsExam(
  meeting: RawMeeting,
  sources: TssExamMeetingSource[],
): boolean {
  const kind = examKind(meeting.meeting_kind);
  if (
    kind &&
    sources.some(
      (source) =>
        source.kind === kind && source.specificDate === meeting.specific_date,
    )
  )
    return true;
  if (
    meeting.meeting_kind === '' &&
    meeting.specific_date === null &&
    meeting.days === null &&
    meeting.start_time?.toLowerCase() === 'tba' &&
    meeting.end_time?.toLowerCase() === 'tba' &&
    meeting.location_displayed === null &&
    !meeting.is_tba &&
    meeting.is_arranged === null
  )
    return true;
  return sources.some(
    (source) =>
      meeting.meeting_kind.toLowerCase() === 'class' &&
      meeting.specific_date === source.specificDate &&
      meeting.days?.toLowerCase() === source.kind,
  );
}

function repairedMeeting(
  source: TssExamMeetingSource,
  fallbackInstructor: string | null,
): RawMeeting {
  return {
    meeting_kind: source.kind,
    specific_date: source.specificDate,
    days: source.days,
    start_time: source.startTime,
    end_time: source.endTime,
    location_displayed: source.location,
    instructor: source.instructor ?? fallbackInstructor,
    is_tba: false,
    is_arranged: null,
  };
}

export function repairTssExamMeetings(
  response: RawTssResponse,
  sources: TssExamMeetingSource[],
): { repairedComponents: number; replacedMeetings: number } {
  const sourcesByComponent = new Map<string, TssExamMeetingSource[]>();
  for (const source of sources) {
    const key = sourceKey(source);
    sourcesByComponent.set(key, [
      ...(sourcesByComponent.get(key) ?? []),
      source,
    ]);
  }

  const matchedKeys = new Set<string>();
  let repairedComponents = 0;
  let replacedMeetings = 0;
  for (const course of response.courses) {
    for (const choice of course.booking_choices) {
      const finalDates: string[] = [];
      for (const component of choice.components) {
        const key = componentKey(course.tss_course_code, component);
        const componentSources = sourcesByComponent.get(key);
        if (!componentSources) continue;
        matchedKeys.add(key);

        const represented = component.meetings.filter((meeting) =>
          representsExam(meeting, componentSources),
        );
        if (represented.length !== componentSources.length) {
          throw new Error(
            `${key}: expected ${componentSources.length} existing exam representation(s), found ${represented.length}`,
          );
        }
        const firstExamIndex = component.meetings.findIndex((meeting) =>
          representsExam(meeting, componentSources),
        );
        const fallbackInstructor =
          represented.find((meeting) => meeting.instructor)?.instructor ??
          component.meetings.find((meeting) => meeting.instructor)
            ?.instructor ??
          null;
        const repaired = componentSources.map((source) =>
          repairedMeeting(source, fallbackInstructor),
        );
        const preserved = component.meetings.filter(
          (meeting) => !representsExam(meeting, componentSources),
        );
        preserved.splice(firstExamIndex, 0, ...repaired);
        component.meetings = preserved;
        finalDates.push(
          ...componentSources
            .filter((source) => source.kind === 'final')
            .map((source) => source.specificDate),
        );
        repairedComponents += 1;
        replacedMeetings += represented.length;
      }

      const distinctFinalDates = [...new Set(finalDates)];
      if (distinctFinalDates.length > 1) {
        throw new Error(
          `${course.tss_course_code}: booking choice has multiple Final dates: ${distinctFinalDates.join(', ')}`,
        );
      }
      const [finalDate] = distinctFinalDates;
      if (finalDate) choice.final_exam_date = finalDate;
    }
  }

  const unmatched = [...sourcesByComponent.keys()].filter(
    (key) => !matchedKeys.has(key),
  );
  if (unmatched.length > 0) {
    throw new Error(
      `Exam source components absent from raw JSON: ${unmatched.join(', ')}`,
    );
  }
  return { repairedComponents, replacedMeetings };
}

function isRecord(input: unknown): input is { [key: string]: unknown } {
  return typeof input === 'object' && input !== null;
}

function isNullableString(input: unknown): input is string | null {
  return typeof input === 'string' || input === null;
}

function isNullableBoolean(input: unknown): input is boolean | null {
  return typeof input === 'boolean' || input === null;
}

export function assertRawTssResponse(
  input: unknown,
): asserts input is RawTssResponse {
  if (!isRecord(input) || !Array.isArray(input.courses))
    throw new Error('Raw TSS JSON must contain a courses array');
  for (const course of input.courses) {
    if (
      !isRecord(course) ||
      typeof course.tss_course_code !== 'string' ||
      !Array.isArray(course.booking_choices)
    )
      throw new Error('Raw TSS course has an invalid shape');
    for (const choice of course.booking_choices) {
      if (!isRecord(choice) || !Array.isArray(choice.components))
        throw new Error('Raw TSS booking choice has an invalid shape');
      for (const component of choice.components) {
        if (
          !isRecord(component) ||
          typeof component.section_code !== 'string' ||
          typeof component.event_id !== 'string' ||
          !Array.isArray(component.meetings)
        )
          throw new Error('Raw TSS component has an invalid shape');
        for (const meeting of component.meetings) {
          if (
            !isRecord(meeting) ||
            typeof meeting.meeting_kind !== 'string' ||
            !isNullableString(meeting.specific_date) ||
            !isNullableString(meeting.days) ||
            !isNullableString(meeting.start_time) ||
            !isNullableString(meeting.end_time) ||
            !isNullableString(meeting.location_displayed) ||
            !isNullableString(meeting.instructor) ||
            typeof meeting.is_tba !== 'boolean' ||
            !isNullableBoolean(meeting.is_arranged)
          )
            throw new Error('Raw TSS meeting has an invalid shape');
        }
      }
    }
  }
}
