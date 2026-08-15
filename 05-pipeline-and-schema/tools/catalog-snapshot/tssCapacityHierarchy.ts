import { z } from 'zod';

const enrollmentSchema = z
  .object({
    enrolled: z.number().nullable(),
    capacity: z.number().nullable(),
    seats_available: z.number().nullable(),
    capacity_kind: z.enum(['bounded', 'effectively_unbounded']).optional(),
    reported_capacity: z.number().nullable().optional(),
    reported_seats_available: z.number().nullable().optional(),
  })
  .passthrough();

const capacityResponseSchema = z
  .object({
    courses: z.array(
      z
        .object({
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

export type ModuleCapacityRow = {
  moduleCode: string;
  capacity: number;
  line: number;
};

function normalizeCharacters(value: string) {
  return value.replace(/[\u2010-\u2013\u2212]/gu, '-').trim();
}

function isEffectivelyUnbounded(value: number) {
  return value === 9999 || value === 99999;
}

export function parseModuleCapacityCsv(contents: string) {
  const lines = contents.split(/\r?\n/u);
  const header = lines[0]?.trim().toLowerCase();
  if (header !== 'module_code,capacity') {
    throw new Error(
      `Expected module_code,capacity header, got ${lines[0] ?? ''}`,
    );
  }
  const rows: ModuleCapacityRow[] = [];
  for (const [index, rawLine] of lines.slice(1).entries()) {
    const line = index + 2;
    const value = normalizeCharacters(rawLine);
    if (!value) continue;
    const cells = value.split(',').map((cell) => cell.trim());
    if (cells.length !== 2)
      throw new Error(`line ${line} must contain exactly two columns`);
    const moduleCode = cells[0]!.toUpperCase();
    if (!/^[A-Z][A-Z\d]{1,7}-\d[A-Z\d-]*$/u.test(moduleCode))
      throw new Error(`line ${line} has invalid module_code: ${moduleCode}`);

    if (!/^\d+$/u.test(cells[1]!))
      throw new Error(`line ${line} has invalid capacity: ${cells[1]}`);
    rows.push({ moduleCode, capacity: Number(cells[1]), line });
  }
  if (rows.length === 0) throw new Error('Capacity CSV contains no rows');
  return rows;
}

function groupRows(rows: ModuleCapacityRow[]) {
  const grouped = new Map<string, ModuleCapacityRow[]>();
  for (const row of rows) {
    const current = grouped.get(row.moduleCode);
    if (current) current.push(row);
    else grouped.set(row.moduleCode, [row]);
  }
  return grouped;
}

function uniqueComponents(course: {
  booking_choices: {
    components: {
      section_code: string;
      enrollment: z.infer<typeof enrollmentSchema>;
    }[];
  }[];
}) {
  const components = new Map<
    string,
    { section_code: string; enrollment: z.infer<typeof enrollmentSchema> }
  >();
  for (const choice of course.booking_choices) {
    for (const component of choice.components) {
      if (!components.has(component.section_code))
        components.set(component.section_code, component);
    }
  }
  return [...components.values()];
}

export function applyModuleCapacitiesByOrderedSectionEvidence(
  response: unknown,
  rows: ModuleCapacityRow[],
) {
  const parsed = capacityResponseSchema.parse(response);
  const rowsByCourse = groupRows(rows);
  const matchedCourses: string[] = [];
  const skippedCourses: {
    course: string;
    reason: 'missing_capacity_rows' | 'row_count_mismatch' | 'value_conflict';
    hierarchyRows: number;
    capacityRows: number;
    details?: string[];
    hierarchySections?: string[];
    capacityValues?: number[];
  }[] = [];
  const mappings = new Map<string, Map<string, ModuleCapacityRow>>();

  for (const course of parsed.courses) {
    const components = uniqueComponents(course);
    const courseRows = rowsByCourse.get(course.tss_course_code);
    if (!courseRows) {
      skippedCourses.push({
        course: course.tss_course_code,
        reason: 'missing_capacity_rows',
        hierarchyRows: components.length,
        capacityRows: 0,
      });
      continue;
    }
    if (courseRows.length !== components.length) {
      skippedCourses.push({
        course: course.tss_course_code,
        reason: 'row_count_mismatch',
        hierarchyRows: components.length,
        capacityRows: courseRows.length,
        hierarchySections: components.map(
          (component) => component.section_code,
        ),
        capacityValues: courseRows.map((row) => row.capacity),
      });
      continue;
    }

    const conflicts = components.flatMap((component, index) => {
      const row = courseRows[index]!;
      const nextCapacity = isEffectivelyUnbounded(row.capacity)
        ? null
        : row.capacity;
      const currentCapacity = component.enrollment.capacity;
      const availableSeats = component.enrollment.seats_available;
      const currentIsUnbounded =
        component.enrollment.capacity_kind === 'effectively_unbounded' ||
        isEffectivelyUnbounded(
          component.enrollment.reported_capacity ?? Number.NaN,
        ) ||
        isEffectivelyUnbounded(
          component.enrollment.reported_seats_available ?? Number.NaN,
        ) ||
        isEffectivelyUnbounded(availableSeats ?? Number.NaN);
      if (isEffectivelyUnbounded(row.capacity) && !currentIsUnbounded) {
        return [
          `${component.section_code}: candidate is unbounded but existing section is not`,
        ];
      }
      if (currentCapacity !== null && currentCapacity !== nextCapacity) {
        return [
          `${component.section_code}: existing capacity ${currentCapacity} != ${row.capacity}`,
        ];
      }
      if (nextCapacity !== null && availableSeats !== nextCapacity) {
        return [
          `${component.section_code}: available seats ${availableSeats} != candidate capacity ${nextCapacity}`,
        ];
      }
      return [];
    });
    if (conflicts.length) {
      skippedCourses.push({
        course: course.tss_course_code,
        reason: 'value_conflict',
        hierarchyRows: components.length,
        capacityRows: courseRows.length,
        details: conflicts,
      });
      continue;
    }

    mappings.set(
      course.tss_course_code,
      new Map(
        components.map((component, index) => [
          component.section_code,
          courseRows[index]!,
        ]),
      ),
    );
    matchedCourses.push(course.tss_course_code);
  }

  let updatedComponentOccurrences = 0;
  const enriched = {
    ...parsed,
    courses: parsed.courses.map((course) => {
      const courseMappings = mappings.get(course.tss_course_code);
      if (!courseMappings) return course;
      return {
        ...course,
        booking_choices: course.booking_choices.map((choice) => ({
          ...choice,
          components: choice.components.map((component) => {
            const row = courseMappings.get(component.section_code);
            if (!row) return component;
            updatedComponentOccurrences += 1;
            if (isEffectivelyUnbounded(row.capacity)) {
              return {
                ...component,
                enrollment: {
                  ...component.enrollment,
                  capacity: null,
                  capacity_kind: 'effectively_unbounded' as const,
                  reported_capacity: row.capacity,
                },
              };
            }
            return {
              ...component,
              enrollment: {
                ...component.enrollment,
                capacity: row.capacity,
                capacity_kind: 'bounded' as const,
                reported_capacity: null,
              },
            };
          }),
        })),
      };
    }),
  };
  const capacityOnlyCourses = [...rowsByCourse.keys()].filter(
    (moduleCode) =>
      !parsed.courses.some((course) => course.tss_course_code === moduleCode),
  );
  return {
    response: enriched,
    report: {
      capacityRows: rows.length,
      capacityCourses: rowsByCourse.size,
      hierarchyCourses: parsed.courses.length,
      matchedByOrderedSectionEvidence: matchedCourses.length,
      matchedUniqueComponents: [...mappings.values()].reduce(
        (count, mapping) => count + mapping.size,
        0,
      ),
      updatedComponentOccurrences,
      skippedCourses,
      capacityOnlyCourses,
    },
  };
}
