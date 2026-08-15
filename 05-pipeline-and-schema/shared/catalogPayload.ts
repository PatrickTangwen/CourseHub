export type CatalogListPayload = {
  [key: string]: unknown;
  courses: { [key: string]: unknown }[];
};

export type CatalogDetailPayload = {
  run_id: string;
  generated_at: string;
  active_planning_term: string;
  courses: {
    course_id: string;
    grade_archive_records: unknown[];
  }[];
};

const encoder = new TextEncoder();

function isObject(value: unknown): value is { [key: string]: unknown } {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function encodeCatalogPayload(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value)}\n`);
}

export function splitPublishedCatalogPayload(snapshotValue: unknown): {
  listPayload: CatalogListPayload;
  detailPayload: CatalogDetailPayload;
} {
  if (!isObject(snapshotValue) || !Array.isArray(snapshotValue.courses))
    throw new Error('Published Snapshot courses are invalid');
  const runId = snapshotValue.run_id;
  const generatedAt = snapshotValue.generated_at;
  const activePlanningTerm = snapshotValue.active_planning_term;
  if (
    typeof runId !== 'string' ||
    typeof generatedAt !== 'string' ||
    typeof activePlanningTerm !== 'string'
  )
    throw new Error('Published Snapshot identity is invalid');

  const detailCourses: CatalogDetailPayload['courses'] = [];
  const listCourses = snapshotValue.courses.map((courseValue) => {
    if (
      !isObject(courseValue) ||
      typeof courseValue.course_id !== 'string' ||
      !Array.isArray(courseValue.grade_archive_records)
    )
      throw new Error('Published Snapshot course details are invalid');
    const { grade_archive_records: gradeArchiveRecords, ...listCourse } =
      courseValue;
    detailCourses.push({
      course_id: courseValue.course_id,
      grade_archive_records: gradeArchiveRecords,
    });
    return listCourse;
  });

  return {
    listPayload: { ...snapshotValue, courses: listCourses },
    detailPayload: {
      run_id: runId,
      generated_at: generatedAt,
      active_planning_term: activePlanningTerm,
      courses: detailCourses,
    },
  };
}
