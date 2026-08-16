import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import postgres from 'postgres';

import { applyHasuraMetadata } from './applyHasuraMetadata.mjs';
import {
  projectPublishedSnapshot,
  queryPublicCourseDataProjection,
} from './courseDataParity.js';
import {
  compareCourseDataParity,
  type DomainProjection,
} from './courseDataParityComparator.js';
import { importSnapshot } from './importSnapshot.mjs';
import { migrateCourseDataStore } from './migrateCourseDataStore.mjs';
import { inspectComposeProject } from '../real-backend-auth-validation/validateRealBackendAuth.mjs';

const execFileAsync = promisify(execFile);

function tracerPort(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535)
    throw new Error(`env config ${name} must be a valid port`);
  return value;
}

const tracer = {
  project:
    process.env.COURSE_DATA_TRACER_PROJECT ??
    `course-data-tracer-${randomBytes(6).toString('hex')}`,
  databasePort: tracerPort('COURSE_DATA_STORE_PORT', 55_489),
  hasuraPort: tracerPort('COURSE_DATA_HASURA_PORT', 18_089),
  publicGraphqlPort: tracerPort('COURSE_DATA_PUBLIC_GRAPHQL_PORT', 18_090),
  staticCatalogPort: tracerPort('STATIC_CATALOG_SMOKE_PORT', 18_091),
  password: randomBytes(24).toString('hex'),
  adminSecret: randomBytes(24).toString('hex'),
  term: 'S326',
  expectedCourses: 119,
  expectedSections: 275,
  expectedMeetings: 353,
  expectedInstructors: 204,
  expectedInstructorLinks: 279,
  expectedGradeRecords: 318,
  expectedAvailabilityObservations: 275,
  expectedManifestCells: 117,
  expectedBoundaryGradeRecords: 1,
  snapshotPath: 'api/static/catalogs/public/S326.json',
  manifestPath: 'api/static/catalogs/import-manifests/S326.json',
  zeroMeetingFixture:
    'tools/course-data-store/fixtures/zero-meeting-snapshot.json',
  partialManifestFixture:
    'tools/course-data-store/fixtures/partial-import-manifest.json',
};
const databaseUrl = `postgresql://course_data:${tracer.password}@localhost:${tracer.databasePort}/course_data`;
const hasuraEndpoint = `http://localhost:${tracer.hasuraPort}`;
const publicGraphqlEndpoint = `http://127.0.0.1:${tracer.publicGraphqlPort}`;

function composeArgs(args: string[]) {
  return [
    'compose',
    '-f',
    'course-data-store/compose.yml',
    '-p',
    tracer.project,
    ...args,
  ];
}

function compose(args: string[]) {
  return execFileAsync('docker', composeArgs(args), {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      COURSE_DATA_STORE_PORT: String(tracer.databasePort),
      COURSE_DATA_HASURA_PORT: String(tracer.hasuraPort),
      COURSE_DATA_STORE_PASSWORD: tracer.password,
      COURSE_DATA_HASURA_ADMIN_SECRET: tracer.adminSecret,
    },
  });
}

async function queryAnonymous(
  query: string,
  browserHeaders: { [header: string]: string } = {},
) {
  const response = await fetch(`${hasuraEndpoint}/v1/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...browserHeaders },
    body: JSON.stringify({ query }),
  });
  return (await response.json()) as {
    data?: { [key: string]: unknown };
    errors?: unknown[];
  };
}

async function queryPublic(
  query: string,
  variables: { [name: string]: unknown } = {},
  browserHeaders: { [header: string]: string } = {},
) {
  const response = await fetch(`${publicGraphqlEndpoint}/ferry/v1/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...browserHeaders },
    body: JSON.stringify({ query, variables }),
  });
  return (await response.json()) as {
    data?: { [key: string]: unknown };
    errors?: unknown[];
  };
}

async function waitForPublicGateway() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const healthy = await fetch(`${publicGraphqlEndpoint}/healthz`)
      .then((response) => response.ok)
      .catch(() => false);
    if (healthy) return;
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  throw new Error('Public GraphQL gateway did not become healthy');
}

async function smokeStaticCatalogEndpoints() {
  const endpoint = `http://127.0.0.1:${tracer.staticCatalogPort}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const healthy = await fetch(`${endpoint}/healthz`)
      .then((response) => response.ok)
      .catch(() => false);
    if (healthy) break;
    if (attempt === 99)
      throw new Error('Static Catalog smoke server did not become healthy');
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  const metadata = await fetch(`${endpoint}/api/catalog/metadata`);
  const snapshot = await fetch(`${endpoint}/api/catalog/public/${tracer.term}`);
  if (!metadata.ok || !snapshot.ok)
    throw new Error('Existing static Catalog endpoint smoke failed');
  const snapshotBody = (await snapshot.json()) as {
    active_planning_term?: string;
  };
  if (snapshotBody.active_planning_term !== tracer.term)
    throw new Error('Static Catalog endpoint served the wrong Supported Term');
}

async function publicArchiveProjection() {
  const terms = `["${tracer.term}", "RELATIONSHIP-EDGE"]`;
  const result = await queryAnonymous(`
    query PublicArchiveProjection {
      supportedTerms(where: {termCode: {_in: ${terms}}}, order_by: {termCode: asc}) {
        termCode termLabel dateStart dateEnd snapshotGeneratedAt
        artifactFingerprint snapshotLifecycle
      }
      courses(where: {termCode: {_in: ${terms}}}, order_by: [{termCode: asc}, {courseId: asc}]) {
        termCode courseId subject courseNumber title units description
        prerequisitesText restrictionsText catalogUrl
      }
      sections(where: {termCode: {_in: ${terms}}}, order_by: [{termCode: asc}, {sectionId: asc}]) {
        termCode sectionId courseId sectionCode meetingType
      }
      meetings(where: {termCode: {_in: ${terms}}}, order_by: [{termCode: asc}, {sectionId: asc}, {meetingIndex: asc}]) {
        termCode sectionId meetingIndex days date startTime endTime building room
        isTba meetingType rawDays rawTime rawLocation
      }
      instructors(order_by: {instructorName: asc}) { instructorName }
      sectionInstructors(where: {termCode: {_in: ${terms}}}, order_by: [{termCode: asc}, {sectionId: asc}, {instructorName: asc}]) {
        termCode sectionId instructorName
      }
      gradeArchiveRecords(where: {termCode: {_in: ${terms}}}, order_by: [{termCode: asc}, {courseId: asc}, {recordIndex: asc}]) {
        termCode courseId recordIndex rawRecord
      }
      snapshotAvailability(where: {termCode: {_in: ${terms}}}, order_by: [{termCode: asc}, {sectionId: asc}]) {
        termCode sectionId enrolled capacity waitlistCount observedAt termState
      }
      courseDataImportRuns(where: {termCode: {_in: ${terms}}}, order_by: [{termCode: asc}, {generatedAt: asc}]) {
        artifactFingerprint snapshotRunId generatedAt termCode snapshotLifecycle
        scheduleSourceTimestamp catalogSourceTimestamp gradeSourceTimestamp
        manifestFingerprint manifestOk manifestEmpty manifestFailed manifestPartial
      }
      importManifestCells(where: {termCode: {_in: ${terms}}}, order_by: [{termCode: asc}, {subject: asc}, {source: asc}]) {
        artifactFingerprint termCode subject source status reason attempts
        rowCounts rawArtifacts normalizedArtifact
      }
    }
  `);
  if (result.errors) throw new Error('Public Term Archive projection failed');
  return result.data;
}

async function acceptedTermCounts() {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [counts] = await sql<
      { courses: number; meetings: number; sections: number }[]
    >`
      select
        (select count(*)::int from courses where term_code = ${tracer.term}) as courses,
        (select count(*)::int from sections where term_code = ${tracer.term}) as sections,
        (select count(*)::int from meetings where term_code = ${tracer.term}) as meetings
    `;
    return counts;
  } finally {
    await sql.end();
  }
}

export async function validateCourseDataTracer() {
  let ownsComposeProject = false;
  let gatewayProcess: ChildProcess | undefined = undefined;
  let staticCatalogProcess: ChildProcess | undefined = undefined;
  let temporaryDirectory: string | undefined = undefined;
  try {
    inspectComposeProject(
      (await compose(['ps', '-a', '--format', 'json'])).stdout,
    );
    ownsComposeProject = true;
    await compose(['up', '-d', '--wait', '--remove-orphans']);
    if (process.env.COURSE_DATA_TRACER_FAILURE_PROBE === 'after-up')
      throw new Error('Injected Course Data tracer failure after startup');
    await migrateCourseDataStore(databaseUrl);
    await migrateCourseDataStore(databaseUrl);
    await applyHasuraMetadata(hasuraEndpoint, tracer.adminSecret);
    gatewayProcess = spawn('bun', ['api/src/graphql/publicGraphqlGateway.ts'], {
      cwd: path.resolve(import.meta.dirname, '../..'),
      env: {
        ...process.env,
        COURSE_DATA_HASURA_ENDPOINT: hasuraEndpoint,
        COURSE_DATA_PUBLIC_GRAPHQL_PORT: String(tracer.publicGraphqlPort),
      },
      stdio: 'ignore',
    });
    await waitForPublicGateway();
    staticCatalogProcess = spawn(
      'bun',
      ['api/src/catalog/staticCatalogSmokeServer.ts'],
      {
        cwd: path.resolve(import.meta.dirname, '../..'),
        env: {
          ...process.env,
          STATIC_CATALOG_SMOKE_PORT: String(tracer.staticCatalogPort),
        },
        stdio: 'ignore',
      },
    );
    await smokeStaticCatalogEndpoints();

    temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'course-data-tracer-'),
    );
    const acceptedManifestPath = path.join(
      temporaryDirectory,
      'accepted-manifest.json',
    );
    const acceptedManifest = JSON.parse(
      await readFile(tracer.manifestPath, 'utf8'),
    ) as {
      cells: {
        subject: string;
        source: string;
        status: string;
        reason: string | null;
      }[];
      summary: { empty: number; failed: number };
    };
    const expectedIncompleteScheduleSubjects = new Set([
      'AIP',
      'CAT',
      'MATH',
      'PSYC',
    ]);
    const acceptedScheduleSubjects = new Set<string>();
    for (const cell of acceptedManifest.cells) {
      if (cell.source !== 'schedule_of_classes' || cell.status !== 'failed')
        continue;
      if (!expectedIncompleteScheduleSubjects.has(cell.subject)) {
        throw new Error(
          `Unexpected failed Schedule cell in S326 acceptance fixture: ${cell.subject}`,
        );
      }
      acceptedScheduleSubjects.add(cell.subject);
      cell.status = 'empty';
      cell.reason = 'Issue #92 validated mutable-term fixture';
      acceptedManifest.summary.failed -= 1;
      acceptedManifest.summary.empty += 1;
    }
    if (
      acceptedScheduleSubjects.size !== expectedIncompleteScheduleSubjects.size
    )
      throw new Error('S326 acceptance fixture did not contain expected cells');

    await writeFile(acceptedManifestPath, JSON.stringify(acceptedManifest));
    const invalidSnapshot = path.join(temporaryDirectory, 'invalid.json');
    await writeFile(invalidSnapshot, JSON.stringify({ courses: [] }));
    await importSnapshot(
      invalidSnapshot,
      databaseUrl,
      acceptedManifestPath,
    ).then(
      () => {
        throw new Error('Invalid Snapshot was accepted');
      },
      (error: unknown) => {
        if (!(error instanceof Error) || !error.message.includes('is invalid'))
          throw error;
      },
    );

    const firstImport = await importSnapshot(
      tracer.snapshotPath,
      databaseUrl,
      acceptedManifestPath,
    );
    const secondImport = await importSnapshot(
      tracer.snapshotPath,
      databaseUrl,
      acceptedManifestPath,
    );
    if (firstImport.courses.created !== tracer.expectedCourses)
      throw new Error('Tracer did not create the expected Course count');
    if (
      firstImport.sections.created !== tracer.expectedSections ||
      firstImport.meetings.created !== tracer.expectedMeetings ||
      firstImport.instructors.created !== tracer.expectedInstructors ||
      firstImport.instructorLinks.created !== tracer.expectedInstructorLinks
    )
      throw new Error('Tracer did not create the expected relationship counts');
    if (
      firstImport.gradeRecords.created !== tracer.expectedGradeRecords ||
      firstImport.availabilityObservations.created !==
        tracer.expectedAvailabilityObservations ||
      firstImport.manifestCells.created !== tracer.expectedManifestCells
    )
      throw new Error('Tracer did not create the expected context counts');
    if (
      secondImport.courses.created !== 0 ||
      secondImport.courses.unchanged !== tracer.expectedCourses ||
      secondImport.sections.unchanged !== tracer.expectedSections ||
      secondImport.meetings.unchanged !== tracer.expectedMeetings ||
      secondImport.instructors.unchanged !== tracer.expectedInstructors ||
      secondImport.instructorLinks.unchanged !==
        tracer.expectedInstructorLinks ||
      secondImport.gradeRecords.unchanged !== tracer.expectedGradeRecords ||
      secondImport.availabilityObservations.unchanged !==
        tracer.expectedAvailabilityObservations ||
      secondImport.manifestCells.unchanged !== tracer.expectedManifestCells ||
      secondImport.importRun !== 'unchanged'
    )
      throw new Error('Tracer import was not idempotent');

    const sourceProjection = await projectPublishedSnapshot(
      tracer.snapshotPath,
      acceptedManifestPath,
    );
    const graphqlProjection = await queryPublicCourseDataProjection(
      queryPublic,
      tracer.term,
    );
    const parity = compareCourseDataParity(sourceProjection, graphqlProjection);
    if (!parity.matches) {
      throw new Error(
        `Published Snapshot parity failed: ${JSON.stringify(parity)}`,
      );
    }

    const cloneProjection = (projection: DomainProjection) =>
      Object.fromEntries(
        Object.entries(projection).map(([category, records]) => [
          category,
          new Map(
            [...records].map(([identity, record]) => [identity, { ...record }]),
          ),
        ]),
      );
    const missingProbe = cloneProjection(graphqlProjection);
    missingProbe.courses?.delete(
      String(sourceProjection.courses?.keys().next().value),
    );
    const extraProbe = cloneProjection(graphqlProjection);
    extraProbe.sectionInstructors?.set('probe:extra-relationship', {
      sectionId: 'probe',
      instructorName: 'probe',
    });
    const changedProbe = cloneProjection(graphqlProjection);
    const firstCourseIdentity = String(
      changedProbe.courses?.keys().next().value,
    );
    const parityFirstCourse = changedProbe.courses?.get(firstCourseIdentity);
    if (!parityFirstCourse) throw new Error('Parity probe requires one Course');
    parityFirstCourse.title = 'material parity probe';
    for (const [name, probe] of [
      ['missing', missingProbe],
      ['extra', extraProbe],
      ['changed', changedProbe],
    ] as const) {
      const probeResult = compareCourseDataParity(sourceProjection, probe);
      if (
        probeResult.matches ||
        probeResult.mismatchCount < 1 ||
        probeResult.mismatches.length > 40
      )
        throw new Error(`Parity comparator missed ${name} probe`);
    }

    const conflictingSnapshotPath = path.join(
      temporaryDirectory,
      'conflicting.json',
    );
    const conflictingSnapshot = JSON.parse(
      await readFile(tracer.snapshotPath, 'utf8'),
    ) as { run_id: string; courses: { title: string }[] };
    conflictingSnapshot.run_id += '-conflict';
    const [firstCourse] = conflictingSnapshot.courses;
    if (!firstCourse) throw new Error('Tracer Snapshot has no Courses');
    firstCourse.title += ' changed';
    await writeFile(
      conflictingSnapshotPath,
      JSON.stringify(conflictingSnapshot),
    );
    const conflictingManifestPath = path.join(
      temporaryDirectory,
      'conflicting-manifest.json',
    );
    const conflictingManifest = JSON.parse(
      await readFile(acceptedManifestPath, 'utf8'),
    ) as { run_id: string };
    conflictingManifest.run_id = conflictingSnapshot.run_id;
    await writeFile(
      conflictingManifestPath,
      JSON.stringify(conflictingManifest),
    );
    await importSnapshot(
      conflictingSnapshotPath,
      databaseUrl,
      conflictingManifestPath,
    ).then(
      () => {
        throw new Error('Conflicting Snapshot artifact was accepted');
      },
      (error: unknown) => {
        if (!(error instanceof Error) || !error.message.includes('not newer'))
          throw error;
      },
    );

    const zeroMeetingImport = await importSnapshot(
      tracer.zeroMeetingFixture,
      databaseUrl,
      tracer.partialManifestFixture,
    );
    const upgradeProbeSql = postgres(databaseUrl, { max: 1 });
    try {
      await upgradeProbeSql`
        update grade_archive_records set matched_via = null
        where term_code = 'RELATIONSHIP-EDGE'
      `;
    } finally {
      await upgradeProbeSql.end();
    }
    const provenanceRepair = await importSnapshot(
      tracer.zeroMeetingFixture,
      databaseUrl,
      tracer.partialManifestFixture,
    );
    const beforeFreeze = await queryAnonymous(`
      query BeforeFreeze {
        supportedTerms(where: {termCode: {_eq: "RELATIONSHIP-EDGE"}}) {
          snapshotLifecycle
          snapshotGeneratedAt
          importRuns { generatedAt snapshotLifecycle }
        }
      }
    `);
    const frozenTransition = await importSnapshot(
      tracer.zeroMeetingFixture,
      databaseUrl,
      tracer.partialManifestFixture,
      { lifecycle: 'frozen' },
    );
    const identicalFrozenImport = await importSnapshot(
      tracer.zeroMeetingFixture,
      databaseUrl,
      tracer.partialManifestFixture,
      { lifecycle: 'frozen' },
    );
    if (
      zeroMeetingImport.sections.created !== 1 ||
      zeroMeetingImport.meetings.created !== 0 ||
      zeroMeetingImport.lifecycle !== 'published' ||
      provenanceRepair.gradeRecords.updated !==
        tracer.expectedBoundaryGradeRecords ||
      provenanceRepair.importRun !== 'unchanged' ||
      frozenTransition.lifecycle !== 'frozen' ||
      frozenTransition.sections.unchanged !== 1 ||
      identicalFrozenImport.sections.unchanged !== 1 ||
      identicalFrozenImport.importRun !== 'unchanged'
    )
      throw new Error(
        `Frozen zero-Meeting fixture was not idempotent: ${JSON.stringify({
          zeroMeetingImport,
          provenanceRepair,
          frozenTransition,
          identicalFrozenImport,
        })}`,
      );
    const afterFreeze = await queryAnonymous(`
      query AfterFreeze {
        supportedTerms(where: {termCode: {_eq: "RELATIONSHIP-EDGE"}}) {
          snapshotLifecycle
          snapshotGeneratedAt
          importRuns { generatedAt snapshotLifecycle }
        }
      }
    `);
    type LifecycleProjection = {
      snapshotLifecycle: string;
      snapshotGeneratedAt: string;
      importRuns: { generatedAt: string; snapshotLifecycle: string }[];
    };
    const beforeFreezeTerm = (
      beforeFreeze.data?.supportedTerms as LifecycleProjection[] | undefined
    )?.[0];
    const afterFreezeTerm = (
      afterFreeze.data?.supportedTerms as LifecycleProjection[] | undefined
    )?.[0];
    if (
      beforeFreeze.errors ||
      afterFreeze.errors ||
      beforeFreezeTerm?.snapshotLifecycle !== 'published' ||
      afterFreezeTerm?.snapshotLifecycle !== 'frozen' ||
      beforeFreezeTerm.snapshotGeneratedAt !==
        afterFreezeTerm.snapshotGeneratedAt ||
      beforeFreezeTerm.importRuns[0]?.generatedAt !==
        afterFreezeTerm.importRuns[0]?.generatedAt ||
      afterFreezeTerm.importRuns[0]?.snapshotLifecycle !== 'frozen'
    )
      throw new Error('Frozen transition changed original provenance');

    const frozenSourceProjection = await projectPublishedSnapshot(
      tracer.zeroMeetingFixture,
      tracer.partialManifestFixture,
      'frozen',
    );
    const frozenGraphqlProjection = await queryPublicCourseDataProjection(
      queryPublic,
      'RELATIONSHIP-EDGE',
    );
    const frozenParity = compareCourseDataParity(
      frozenSourceProjection,
      frozenGraphqlProjection,
    );
    if (!frozenParity.matches) {
      throw new Error(
        `Frozen Snapshot parity failed: ${JSON.stringify(frozenParity)}`,
      );
    }

    const frozenOverwritePath = path.join(
      temporaryDirectory,
      'frozen-overwrite.json',
    );
    const frozenOverwrite = JSON.parse(
      await readFile(tracer.zeroMeetingFixture, 'utf8'),
    ) as {
      run_id: string;
      generated_at: string;
      courses: { title: string }[];
    };
    frozenOverwrite.run_id += '-overwrite';
    frozenOverwrite.generated_at = new Date(
      new Date(frozenOverwrite.generated_at).getTime() + 60_000,
    ).toISOString();
    const [frozenCourse] = frozenOverwrite.courses;
    if (!frozenCourse) throw new Error('Frozen fixture has no Course');
    frozenCourse.title += ' changed';
    await writeFile(frozenOverwritePath, JSON.stringify(frozenOverwrite));
    const frozenOverwriteManifestPath = path.join(
      temporaryDirectory,
      'frozen-overwrite-manifest.json',
    );
    const frozenOverwriteManifest = JSON.parse(
      await readFile(tracer.partialManifestFixture, 'utf8'),
    ) as { run_id: string; generated_at: string };
    frozenOverwriteManifest.run_id = frozenOverwrite.run_id;
    frozenOverwriteManifest.generated_at = frozenOverwrite.generated_at;
    await writeFile(
      frozenOverwriteManifestPath,
      JSON.stringify(frozenOverwriteManifest),
    );
    await importSnapshot(
      frozenOverwritePath,
      databaseUrl,
      frozenOverwriteManifestPath,
      { lifecycle: 'frozen' },
    ).then(
      () => {
        throw new Error('Frozen Snapshot overwrite was accepted');
      },
      (error: unknown) => {
        if (!(error instanceof Error) || !error.message.includes('immutable'))
          throw error;
      },
    );

    const failedRelationshipPath = path.join(
      temporaryDirectory,
      'failed-relationship.json',
    );
    const failedRelationship = JSON.parse(
      await readFile(tracer.zeroMeetingFixture, 'utf8'),
    ) as {
      run_id: string;
      active_planning_term: string;
      term_label: string;
      courses: { sections: { section_id: string; course_id: string }[] }[];
    };
    failedRelationship.run_id = 'failed-relationship-import';
    failedRelationship.active_planning_term = 'FAILED-RELATIONSHIP';
    failedRelationship.term_label = 'Failed Relationship Fixture';
    const [failedCourse] = failedRelationship.courses;
    const [failedSection] = failedCourse?.sections ?? [];
    if (!failedSection) throw new Error('Relationship fixture has no Section');
    failedSection.section_id = 'FAILED-RELATIONSHIP:0';
    failedSection.course_id = 'MISSING:0';
    await writeFile(failedRelationshipPath, JSON.stringify(failedRelationship));
    const failedManifestPath = path.join(
      temporaryDirectory,
      'failed-relationship-manifest.json',
    );
    const failedManifest = JSON.parse(
      await readFile(tracer.partialManifestFixture, 'utf8'),
    ) as {
      run_id: string;
      active_planning_term: string;
      term_label: string;
      cells: { term: string }[];
    };
    failedManifest.run_id = failedRelationship.run_id;
    failedManifest.active_planning_term =
      failedRelationship.active_planning_term;
    failedManifest.term_label = failedRelationship.term_label;
    for (const cell of failedManifest.cells)
      cell.term = failedRelationship.active_planning_term;
    await writeFile(failedManifestPath, JSON.stringify(failedManifest));
    const archiveBeforeFailure = await publicArchiveProjection();
    await importSnapshot(
      failedRelationshipPath,
      databaseUrl,
      failedManifestPath,
    ).then(
      () => {
        throw new Error('Invalid relationship import was accepted');
      },
      (error: unknown) => {
        if (
          !(error instanceof Error) ||
          !error.message.includes('invalid Section relationship')
        )
          throw error;
      },
    );
    const archiveAfterFailure = await publicArchiveProjection();
    if (
      JSON.stringify(archiveAfterFailure) !==
      JSON.stringify(archiveBeforeFailure)
    )
      throw new Error('Failed import changed another Supported Term');
    const preservedCounts = await acceptedTermCounts();
    if (
      preservedCounts?.courses !== tracer.expectedCourses ||
      preservedCounts.sections !== tracer.expectedSections ||
      preservedCounts.meetings !== tracer.expectedMeetings
    )
      throw new Error('Failed relationship import changed accepted projection');

    const archive = await queryAnonymous(`
      query TermArchive {
        supportedTerms(
          where: {termCode: {_in: ["${tracer.term}", "RELATIONSHIP-EDGE"]}},
          order_by: {termCode: asc}
        ) {
          termCode
          snapshotLifecycle
          snapshotGeneratedAt
          courses { courseId }
          importRuns { snapshotLifecycle generatedAt }
        }
        frozenAvailability: snapshotAvailability(
          where: {termCode: {_eq: "RELATIONSHIP-EDGE"}}
        ) { termCode termState observedAt }
      }
    `);
    const archiveTerms = archive.data?.supportedTerms as
      | {
          termCode: string;
          snapshotLifecycle: string;
          courses: unknown[];
          importRuns: { snapshotLifecycle: string }[];
        }[]
      | undefined;
    const frozenAvailability = archive.data?.frozenAvailability as
      | { termState: string }[]
      | undefined;
    if (
      archive.errors ||
      archiveTerms?.length !== 2 ||
      archiveTerms.find(({ termCode }) => termCode === tracer.term)
        ?.snapshotLifecycle !== 'published' ||
      archiveTerms.find(({ termCode }) => termCode === 'RELATIONSHIP-EDGE')
        ?.snapshotLifecycle !== 'frozen' ||
      archiveTerms.find(({ termCode }) => termCode === 'RELATIONSHIP-EDGE')
        ?.importRuns[0]?.snapshotLifecycle !== 'frozen' ||
      frozenAvailability?.[0]?.termState !== 'historical'
    )
      throw new Error('Term Archive lifecycle did not round-trip');

    const result = await queryAnonymous(`
      query CourseDataTracer {
        supportedTerms(where: {termCode: {_eq: "${tracer.term}"}}) {
          termCode
          termLabel
          courses(order_by: {courseId: asc}) {
            courseId
            subject
            courseNumber
            title
          }
        }
      }
    `);
    const terms = result.data?.supportedTerms as
      | { termCode: string; courses: unknown[] }[]
      | undefined;
    if (
      result.errors ||
      terms?.length !== 1 ||
      terms[0]?.termCode !== tracer.term
    )
      throw new Error('Anonymous Supported Term query failed');
    if (terms[0].courses.length !== 100)
      throw new Error('Anonymous Course query exceeded its public row limit');

    const paginated = await queryPublic(
      `query PaginatedTermCourses($term: String!, $limit: Int!, $offset: Int!) {
        courses(
          where: {termCode: {_eq: $term}},
          order_by: {courseId: asc},
          limit: $limit,
          offset: $offset
        ) { termCode courseId }
      }`,
      { term: tracer.term, limit: 2, offset: 1 },
    );
    const paginatedCourses = paginated.data?.courses as
      | { termCode: string; courseId: string }[]
      | undefined;
    if (
      paginated.errors ||
      paginatedCourses?.length !== 2 ||
      paginatedCourses.some(({ termCode }) => termCode !== tracer.term) ||
      paginatedCourses[0]?.courseId !== 'AIP:197EX' ||
      paginatedCourses[1]?.courseId !== 'AIP:197P'
    )
      throw new Error('Term-scoped Course pagination failed');

    const relationships = await queryAnonymous(`
      query RelationshipTracer {
        multiMeeting: courses(where: {
          termCode: {_eq: "${tracer.term}"},
          courseId: {_eq: "AIP:197EX"}
        }) {
          sections(where: {sectionId: {_eq: "S326:265969"}}) {
            sectionId
            meetings(order_by: {meetingIndex: asc}) {
              meetingIndex
              isTba
              days
              startTime
              endTime
              building
              room
              rawDays
              rawTime
              rawLocation
            }
          }
        }
        oneMeeting: courses(where: {
          termCode: {_eq: "${tracer.term}"},
          courseId: {_eq: "AIP:97"}
        }) {
          sections(where: {sectionId: {_eq: "S326:280129"}}) {
            sectionId
            meetings { meetingIndex }
          }
        }
        teamTaught: courses(where: {
          termCode: {_eq: "${tracer.term}"},
          courseId: {_eq: "MGTA:451"}
        }) {
          sections(where: {sectionId: {_eq: "S326:278397"}}) {
            sectionId
            instructorLinks {
              instructor { instructorName }
            }
          }
        }
        zeroMeeting: courses(where: {
          termCode: {_eq: "RELATIONSHIP-EDGE"},
          courseId: {_eq: "TEST:0"}
        }) {
          sections {
            sectionId
            meetings { meetingIndex }
          }
        }
      }
    `);
    if (relationships.errors)
      throw new Error('Anonymous relationship query failed');
    const multiMeeting = relationships.data?.multiMeeting as
      | {
          sections: {
            meetings: {
              isTba: boolean;
              days: string[];
              startTime: string | null;
              endTime: string | null;
              building: string | null;
              room: string | null;
              rawDays: string | null;
              rawTime: string | null;
              rawLocation: string | null;
            }[];
          }[];
        }[]
      | undefined;
    if (multiMeeting?.[0]?.sections[0]?.meetings.length !== 2)
      throw new Error('Multiple Meetings did not round-trip');
    if (
      !multiMeeting[0].sections[0].meetings.every(
        ({
          building,
          days,
          endTime,
          isTba,
          rawDays,
          rawLocation,
          rawTime,
          room,
          startTime,
        }) =>
          isTba &&
          days.length === 0 &&
          startTime === null &&
          endTime === null &&
          building === null &&
          room === null &&
          rawDays === 'TBA' &&
          rawTime === 'TBA' &&
          rawLocation === 'TBA',
      )
    )
      throw new Error('TBA Meeting semantics did not round-trip');
    const oneMeeting = relationships.data?.oneMeeting as
      | { sections: { meetings: unknown[] }[] }[]
      | undefined;
    if (oneMeeting?.[0]?.sections[0]?.meetings.length !== 1)
      throw new Error('One Meeting did not round-trip');
    const teamTaught = relationships.data?.teamTaught as
      | {
          sections: {
            instructorLinks: { instructor: { instructorName: string } }[];
          }[];
        }[]
      | undefined;
    if (teamTaught?.[0]?.sections[0]?.instructorLinks.length !== 3) {
      throw new Error(
        'Team-taught instructor relationships did not round-trip',
      );
    }
    const teamTaughtNames = new Set(
      teamTaught[0].sections[0].instructorLinks.map(
        ({ instructor }) => instructor.instructorName,
      ),
    );
    for (const expectedName of [
      'Wilbur, Kenneth C',
      'Buti, Krisztina',
      'Shahsavand, Shirin',
    ]) {
      if (!teamTaughtNames.has(expectedName))
        throw new Error('Team-taught instructor identity did not round-trip');
    }
    const zeroMeeting = relationships.data?.zeroMeeting as
      | { sections: { meetings: unknown[] }[] }[]
      | undefined;
    if (zeroMeeting?.[0]?.sections[0]?.meetings.length !== 0)
      throw new Error('Zero Meetings did not round-trip');

    const context = await queryAnonymous(`
      query HistoricalAndOperationalContext {
        gradeCourse: courses(where: {
          termCode: {_eq: "${tracer.term}"},
          courseId: {_eq: "ANAR:135"}
        }) {
          gradeArchiveRecords(order_by: {recordIndex: asc}, limit: 1) {
            year
            quarter
            instructor
            gpa
            aPercent
            rawRecord
          }
        }
        provenanceCourse: courses(where: {
          termCode: {_eq: "RELATIONSHIP-EDGE"},
          courseId: {_eq: "TEST:0"}
        }) {
          gradeArchiveRecords(limit: 1) {
            subject
            courseNumber
            matchedVia
          }
        }
        availabilitySection: sections(where: {
          termCode: {_eq: "${tracer.term}"},
          sectionId: {_eq: "S326:265969"}
        }) {
          snapshotAvailability {
            enrolled
            capacity
            waitlistCount
            observedAt
            termState
          }
        }
        importRun: courseDataImportRuns(where: {termCode: {_eq: "${tracer.term}"}}) {
          snapshotRunId
          generatedAt
          scheduleSourceTimestamp
          catalogSourceTimestamp
          gradeSourceTimestamp
          manifestOk
          manifestEmpty
          manifestFailed
          manifestPartial
        }
        okCells: importManifestCells(where: {termCode: {_eq: "${tracer.term}"}, status: {_eq: "ok"}}, limit: 1) { status }
        emptyCells: importManifestCells(where: {termCode: {_eq: "${tracer.term}"}, status: {_eq: "empty"}}, limit: 1) { status }
        failedCells: importManifestCells(where: {termCode: {_eq: "${tracer.term}"}, status: {_eq: "failed"}}, limit: 1) { status reason }
        partialCells: importManifestCells(where: {termCode: {_eq: "RELATIONSHIP-EDGE"}, status: {_eq: "partial"}}, limit: 1) { status reason rowCounts }
      }
    `);
    if (context.errors) throw new Error('Anonymous context query failed');
    const gradeCourse = context.data?.gradeCourse as
      | { gradeArchiveRecords: { [key: string]: unknown }[] }[]
      | undefined;
    const grade = gradeCourse?.[0]?.gradeArchiveRecords[0];
    if (
      grade?.year !== '23' ||
      grade.quarter !== 'WI' ||
      grade.instructor !== 'Braswell, Geoffrey E.' ||
      Number(grade.gpa) !== 3.988 ||
      Number(grade.aPercent) !== 100 ||
      typeof grade.rawRecord !== 'object'
    )
      throw new Error('Grade Archive Record did not round-trip');
    const provenanceCourse = context.data?.provenanceCourse as
      | { gradeArchiveRecords: { [key: string]: unknown }[] }[]
      | undefined;
    const provenance = provenanceCourse?.[0]?.gradeArchiveRecords[0];
    if (
      provenance?.subject !== 'SOURCE' ||
      provenance.courseNumber !== '0' ||
      provenance.matchedVia !== 'cross_listed'
    )
      throw new Error(
        'Cross-listed Grade Archive provenance did not round-trip',
      );
    const availabilitySections = context.data?.availabilitySection as
      | { snapshotAvailability: { [key: string]: unknown } | null }[]
      | undefined;
    const availability = availabilitySections?.[0]?.snapshotAvailability;
    if (
      availability?.enrolled !== 39 ||
      availability.capacity !== 50 ||
      availability.waitlistCount !== 0 ||
      availability.observedAt !== '2026-06-29T08:02:01.606+00:00' ||
      availability.termState !== 'active'
    )
      throw new Error('Snapshot Availability Data did not round-trip');
    const importRuns = context.data?.importRun as
      | { [key: string]: unknown }[]
      | undefined;
    const [importRun] = importRuns ?? [];
    if (
      importRun?.generatedAt !== '2026-06-29T08:02:01.606+00:00' ||
      importRun.scheduleSourceTimestamp !== '06/28/2026, 02:05:00' ||
      importRun.manifestOk !== 99 ||
      importRun.manifestEmpty !== 15 ||
      importRun.manifestFailed !== 3 ||
      importRun.manifestPartial !== 0
    )
      throw new Error('Import provenance did not round-trip');
    for (const [field, status] of [
      ['okCells', 'ok'],
      ['emptyCells', 'empty'],
      ['failedCells', 'failed'],
      ['partialCells', 'partial'],
    ] as const) {
      const cells = context.data?.[field] as { status: string }[] | undefined;
      if (cells?.[0]?.status !== status)
        throw new Error(`Import Manifest ${status} cell was not queryable`);
    }
    const averageGpa = await queryAnonymous('{ courses { averageGpa } }');
    if (!averageGpa.errors)
      throw new Error('A single course-level Average GPA was exposed');

    const privateQuery = await queryAnonymous('{ appUsers { id } }');
    if (!privateQuery.errors)
      throw new Error('App DB data appeared in Course Data Store GraphQL');
    const mutation = await queryAnonymous(`
      mutation AnonymousCourseMutation {
        insert_courses_one(object: {
          termCode: "${tracer.term}",
          courseId: "INVALID:0",
          subject: "INVALID",
          courseNumber: "0",
          title: "Invalid"
        }) { courseId }
      }
    `);
    if (!mutation.errors)
      throw new Error('Anonymous Course Data Store mutation was allowed');

    const approvedBoundary = await queryPublic(`
      query ApprovedPublicBoundary {
        supportedTerms(where: {termCode: {_eq: "${tracer.term}"}}, limit: 1) {
          termCode termLabel snapshotLifecycle snapshotGeneratedAt
          courses(limit: 2) {
            termCode courseId title
            sections(limit: 2) {
              termCode sectionId
              meetings(limit: 2) { sectionId meetingIndex isTba }
              instructorLinks(limit: 2) {
                sectionId instructor { instructorName }
              }
              snapshotAvailability { sectionId observedAt termState }
            }
            gradeArchiveRecords(limit: 2) { courseId recordIndex gpa }
          }
          importRuns(limit: 2) { termCode generatedAt snapshotLifecycle }
          importManifestCells(limit: 2) { termCode subject source status }
        }
      }
    `);
    if (approvedBoundary.errors)
      throw new Error('Approved public GraphQL boundary query failed');

    for (const rejectedQuery of [
      '{ courses(limit: 1) { courseId } }',
      `{ courses(where: {termCode: {_eq: "${tracer.term}"}}) { courseId } }`,
      `{ supportedTerms(where: {termCode: {_eq: "${tracer.term}"}}, limit: 1) {
          courses { courseId }
        } }`,
      `{ first: courses(where: {termCode: {_eq: "${tracer.term}"}}, limit: 1) { courseId }
         second: sections(where: {termCode: {_eq: "${tracer.term}"}}, limit: 1) { sectionId } }`,
    ]) {
      const rejected = await queryPublic(rejectedQuery);
      if (!rejected.errors)
        throw new Error('Unbounded public GraphQL query was accepted');
    }
    const aliasedRelationships = Array.from(
      { length: 13 },
      (_, index) => `courses${index}: courses(limit: 1) { courseId }`,
    ).join('\n');
    const aliasFanout = await queryPublic(`
      query AliasFanout {
        supportedTerms(where: {termCode: {_eq: "${tracer.term}"}}, limit: 1) {
          ${aliasedRelationships}
        }
      }
    `);
    if (!aliasFanout.errors)
      throw new Error('Aliased relationship fan-out exceeded query budget');

    for (const privateRoot of [
      'appUsers',
      'emailVerificationCodes',
      'savedSearches',
      'savedWorksheets',
      'savedWorksheetSections',
    ]) {
      const privateResult = await queryAnonymous(
        `{ ${privateRoot} { __typename } }`,
      );
      if (!privateResult.errors)
        throw new Error('Account-owned App DB root appeared in public GraphQL');
    }

    const roleSpoof = await queryPublic(
      `mutation SpoofedAdmin {
        insert_courses_one(object: {
          termCode: "${tracer.term}", courseId: "INVALID:ROLE",
          subject: "INVALID", courseNumber: "ROLE", title: "Invalid"
        }) { courseId }
      }`,
      {},
      { 'x-hasura-role': 'admin' },
    );
    if (!roleSpoof.errors)
      throw new Error('Browser-controlled Hasura role escalated privileges');

    const adminHeaderSpoof = await queryPublic(
      `{ supportedTerms(where: {termCode: {_eq: "${tracer.term}"}}, limit: 1) { termCode } }`,
      {},
      { 'x-hasura-admin-secret': 'browser-controlled-invalid-secret' },
    );
    const adminSpoofTerms = adminHeaderSpoof.data?.supportedTerms as
      | { termCode: string }[]
      | undefined;
    if (
      adminHeaderSpoof.errors ||
      adminSpoofTerms?.[0]?.termCode !== tracer.term
    )
      throw new Error('Browser admin header was not sanitized to anonymous');

    const metadataResponse = await fetch(`${hasuraEndpoint}/v1/metadata`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'export_metadata', args: {} }),
    });
    if (metadataResponse.ok)
      throw new Error('Anonymous metadata API access was allowed');

    const introspection = await queryPublic(`
      query PublicSchemaContract {
        __schema {
          mutationType { name }
          queryType { fields { name } }
        }
      }
    `);
    const publicSchema = introspection.data?.__schema as
      | {
          mutationType: { name: string } | null;
          queryType: { fields: { name: string }[] };
        }
      | undefined;
    const publicRootNames = new Set(
      publicSchema?.queryType.fields.map(({ name }) => name) ?? [],
    );
    if (
      introspection.errors ||
      publicSchema?.mutationType !== null ||
      [
        'appUsers',
        'emailVerificationCodes',
        'savedSearches',
        'savedWorksheets',
        'listings',
        'seasons',
        'evaluations',
        'friends',
      ].some((name) => publicRootNames.has(name))
    )
      throw new Error('Public introspection exposed an unapproved contract');

    const recursiveExpansion = await queryPublic(`
      query RecursiveExpansion {
        supportedTerms(where: {termCode: {_eq: "${tracer.term}"}}, limit: 1) {
          courses(limit: 1) {
            sections(limit: 1) {
              course { supportedTerm { courses { courseId } } }
            }
          }
        }
      }
    `);
    if (!recursiveExpansion.errors)
      throw new Error('Recursive public relationship expansion was allowed');

    const replacementSnapshotPath = path.join(
      temporaryDirectory,
      'newer-snapshot.json',
    );
    const replacementManifestPath = path.join(
      temporaryDirectory,
      'newer-manifest.json',
    );
    const replacementSnapshot = JSON.parse(
      await readFile(tracer.snapshotPath, 'utf8'),
    ) as {
      run_id: string;
      generated_at: string;
      courses: {
        course_id: string;
        title: string;
        sections: { meetings: unknown[]; instructors: string[] }[];
        grade_archive_records: unknown[];
      }[];
    };
    replacementSnapshot.run_id += '-newer';
    replacementSnapshot.generated_at = new Date(
      new Date(replacementSnapshot.generated_at).getTime() + 60_000,
    ).toISOString();
    const removedCourse = replacementSnapshot.courses.pop();
    const [updatedCourse] = replacementSnapshot.courses;
    if (!removedCourse || !updatedCourse)
      throw new Error('Replacement fixture lacks representative Courses');
    const removedSectionCount = removedCourse.sections.length;
    const removedMeetingCount = removedCourse.sections.reduce(
      (total, section) => total + section.meetings.length,
      0,
    );
    updatedCourse.title += ' refreshed';
    await writeFile(
      replacementSnapshotPath,
      JSON.stringify(replacementSnapshot),
    );
    const replacementManifest = JSON.parse(
      await readFile(acceptedManifestPath, 'utf8'),
    ) as {
      run_id: string;
      generated_at: string;
      cells: { source: string; status: string; reason: string | null }[];
      summary: { empty: number; failed: number };
    };
    replacementManifest.run_id = replacementSnapshot.run_id;
    replacementManifest.generated_at = replacementSnapshot.generated_at;
    for (const cell of replacementManifest.cells) {
      if (cell.source !== 'schedule_of_classes' || cell.status !== 'failed')
        continue;
      cell.status = 'empty';
      cell.reason = 'Issue #92 validated replacement fixture';
      replacementManifest.summary.failed -= 1;
      replacementManifest.summary.empty += 1;
    }
    await writeFile(
      replacementManifestPath,
      JSON.stringify(replacementManifest),
    );

    const beforeDryRun = await acceptedTermCounts();
    const dryRun = await importSnapshot(
      replacementSnapshotPath,
      databaseUrl,
      replacementManifestPath,
      { dryRun: true },
    );
    const afterDryRun = await acceptedTermCounts();
    if (
      !dryRun.dryRun ||
      dryRun.courses.removed !== 1 ||
      dryRun.courses.updated !== 1 ||
      dryRun.courses.unchanged !== tracer.expectedCourses - 2 ||
      dryRun.courses.identities.removed[0] !== removedCourse.course_id ||
      JSON.stringify(beforeDryRun) !== JSON.stringify(afterDryRun)
    ) {
      throw new Error(
        `Dry run mutated state or omitted removal evidence: ${JSON.stringify({ dryRun, beforeDryRun, afterDryRun })}`,
      );
    }

    const { promise: replacementPaused, resolve: releaseReplacement } =
      Promise.withResolvers<undefined>();
    const { promise: removalStarted, resolve: removalReached } =
      Promise.withResolvers<undefined>();
    const replacementPromise = importSnapshot(
      replacementSnapshotPath,
      databaseUrl,
      replacementManifestPath,
      {
        async afterTermRemoval() {
          removalReached(undefined);
          await replacementPaused;
        },
      },
    );
    await removalStarted;
    const duringReplacement = await queryAnonymous(`
      query DuringReplacement {
        supportedTerms(where: {termCode: {_eq: "${tracer.term}"}}) {
          courses { courseId }
        }
      }
    `);
    const visibleCourses = (
      duringReplacement.data?.supportedTerms as { courses: unknown[] }[]
    )[0]?.courses;
    if (duringReplacement.errors || visibleCourses?.length !== 100)
      throw new Error('Concurrent reader observed a mixed replacement');
    releaseReplacement(undefined);
    const replacement = await replacementPromise;
    if (replacement.courses.removed !== 1) {
      throw new Error(
        'Replacement did not report an explicitly removed Course',
      );
    }

    const failedSnapshot = JSON.parse(
      await readFile(replacementSnapshotPath, 'utf8'),
    ) as typeof replacementSnapshot;
    failedSnapshot.run_id += '-failed';
    failedSnapshot.generated_at = new Date(
      new Date(failedSnapshot.generated_at).getTime() + 60_000,
    ).toISOString();
    const failedSnapshotPath = path.join(
      temporaryDirectory,
      'failed-newer.json',
    );
    await writeFile(failedSnapshotPath, JSON.stringify(failedSnapshot));
    const failedNewerManifest = JSON.parse(
      await readFile(replacementManifestPath, 'utf8'),
    ) as typeof replacementManifest;
    failedNewerManifest.run_id = failedSnapshot.run_id;
    failedNewerManifest.generated_at = failedSnapshot.generated_at;
    const failedNewerManifestPath = path.join(
      temporaryDirectory,
      'failed-newer-manifest.json',
    );
    await writeFile(
      failedNewerManifestPath,
      JSON.stringify(failedNewerManifest),
    );
    await importSnapshot(
      failedSnapshotPath,
      databaseUrl,
      failedNewerManifestPath,
      { failAfterTermRemoval: true },
    ).then(
      () => {
        throw new Error('Injected mid-import failure was accepted');
      },
      (error: unknown) => {
        if (!(error instanceof Error) || !error.message.includes('Injected'))
          throw error;
      },
    );
    const afterFailure = await queryAnonymous(`
      query AfterFailedReplacement {
        supportedTerms(where: {termCode: {_eq: "${tracer.term}"}}) {
          courses { courseId }
        }
      }
    `);
    const preservedReplacementCourses = (
      afterFailure.data?.supportedTerms as { courses: unknown[] }[]
    )[0]?.courses;
    if (afterFailure.errors || preservedReplacementCourses?.length !== 100) {
      throw new Error(
        'Failed replacement damaged the accepted GraphQL projection',
      );
    }

    const sql = postgres(databaseUrl, { max: 1 });
    try {
      const [counts] = await sql<
        {
          courses: number;
          runs: number;
          terms: number;
          sections: number;
          meetings: number;
          instructors: number;
          instructorLinks: number;
          gradeRecords: number;
          availability: number;
          manifestCells: number;
        }[]
      >`
        select
          (select count(*)::int from courses) as courses,
          (select count(*)::int from import_runs) as runs,
          (select count(*)::int from supported_terms) as terms,
          (select count(*)::int from sections) as sections,
          (select count(*)::int from meetings) as meetings,
          (select count(*)::int from instructors) as instructors,
          (select count(*)::int from section_instructors) as "instructorLinks",
          (select count(*)::int from grade_archive_records) as "gradeRecords",
          (select count(*)::int from snapshot_availability) as availability,
          (select count(*)::int from import_manifest_cells) as "manifestCells"
      `;
      if (
        counts?.courses !== tracer.expectedCourses ||
        counts.runs !== 3 ||
        counts.terms !== 2 ||
        counts.sections !== tracer.expectedSections + 1 - removedSectionCount ||
        counts.meetings !== tracer.expectedMeetings - removedMeetingCount ||
        counts.gradeRecords !==
          tracer.expectedGradeRecords -
            removedCourse.grade_archive_records.length +
            tracer.expectedBoundaryGradeRecords ||
        counts.availability !==
          tracer.expectedAvailabilityObservations + 1 - removedSectionCount ||
        counts.manifestCells !== tracer.expectedManifestCells * 2 + 3
      )
        throw new Error('Course Data Store counts were not idempotent');
    } finally {
      await sql.end();
    }

    return {
      result: 'passed',
      term: tracer.term,
      courses: tracer.expectedCourses,
      sections: tracer.expectedSections,
      meetings: tracer.expectedMeetings,
      instructors: tracer.expectedInstructors,
      instructorLinks: tracer.expectedInstructorLinks,
      gradeRecords: tracer.expectedGradeRecords,
      availabilityObservations: tracer.expectedAvailabilityObservations,
      manifestCells: tracer.expectedManifestCells,
      importRuns: 3,
      supportedTerms: 2,
      publishedToFrozenTransition: true,
      frozenIdempotent: true,
      frozenOverwriteRejected: true,
      crossTermIsolation: true,
      historicalFrozenAvailability: true,
      zeroMeetingRoundTrip: true,
      oneMeetingRoundTrip: true,
      multipleMeetingRoundTrip: true,
      tbaRoundTrip: true,
      teamTaughtRoundTrip: true,
      failedRelationshipPreservedProjection: true,
      rawGradeRecords: true,
      crossListedGradeProvenance: true,
      sameFingerprintProvenanceRepair: true,
      noAverageGpa: true,
      timestampedSnapshotAvailability: true,
      manifestStatusesQueryable: true,
      importProvenanceQueryable: true,
      anonymousRead: true,
      anonymousWriteDenied: true,
      appDbExcluded: true,
      termScopedPagination: true,
      serverRowLimits: true,
      metadataDenied: true,
      publicIntrospectionBounded: true,
      browserRoleEscalationDenied: true,
      browserAdminHeaderDenied: true,
      recursiveExpansionDenied: true,
      idempotent: true,
      migrationRerun: true,
      publishedSnapshotSemanticParity: true,
      paritySensitivityProbes: true,
      frozenSnapshotSemanticParity: true,
      staticCatalogEndpointsUnchanged: true,
      health: {
        courseDataStore: true,
        hasura: true,
        publicGraphqlGateway: true,
        staticCatalog: true,
      },
    };
  } finally {
    staticCatalogProcess?.kill('SIGTERM');
    gatewayProcess?.kill('SIGTERM');
    if (temporaryDirectory)
      await rm(temporaryDirectory, { force: true, recursive: true });
    if (ownsComposeProject) {
      await compose(['down', '--volumes', '--remove-orphans']).catch(() => {
        throw new Error('Course Data tracer cleanup failed');
      });
    }
  }
}

if (import.meta.main)
  console.log(JSON.stringify(await validateCourseDataTracer(), null, 2));
