/**
 * Convert a Class Planner catalog scrape (classplanner-catalog-v1, produced by
 * classplannerCatalog.ts) into the tss-chatbot-v1 schedule format consumed by
 * tools/catalog-snapshot/generate-tss-published-snapshot.mts.
 *
 * Booking-choice reconstruction: every Class Planner section lists the
 * event_package_ids it participates in. Within one module, a package id
 * identifies one bookable combination (e.g. lecture + discussion). The id list
 * also carries planner-internal group ids that are not bookable combinations;
 * those are recognizable because they repeat an instruction type (a real
 * combination books one section per type, which is also what the Class
 * Planner frontend validates). Sections without package ids are TSS linked
 * events, resolved through the section-code hierarchy FAMILY-INDEX-TYPE
 * (e.g. 001-001-OT): a group sharing FAMILY-INDEX with a packaged section
 * joins that section's packages; a group with no packaged sibling combines
 * with the sections shared by every package of its family (e.g. an overflow
 * lab joins the family lecture); a family with no packages at all books as
 * one group. Packages whose component set is a strict subset of another are
 * display artifacts and are dropped. This reproduces the booking-choice
 * grouping of the previous TSS OData exports for the same term.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type PlannerMeeting = {
  meeting_kind: string;
  specific_date: string | null;
  day_code: string | null;
  start_time_display: string | null;
  end_time_display: string | null;
  building_code: string | null;
  room_code: string | null;
  is_remote: boolean | null;
  is_tba: boolean | null;
};

type PlannerSection = {
  section_id: string;
  section_ref: string;
  section_code: string;
  instruction_type_name: string;
  status: string | null;
  event_package_ids: string[] | null;
  instructors: string[];
  capacity: number | null;
  enrolled: number | null;
  seats_available: number | null;
  waitlist_capacity: number | null;
  waitlist_enrolled: number | null;
  waitlist_available: number | null;
  meetings: PlannerMeeting[];
};

type PlannerCourse = {
  module_code: string;
  module_name: string;
  sections: PlannerSection[];
};

type PlannerScrape = {
  schema_version: string;
  term_code: string;
  fetched_at: string;
  courses: PlannerCourse[];
};

type PlannerTerms = {
  terms: { term_code: string; last_full_refresh_at: string }[];
};

type PlannerFilters = { subjects: { value: string }[] };

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf-8')) as T;
}

function toMeeting(meeting: PlannerMeeting) {
  return {
    meeting_kind: meeting.meeting_kind,
    specific_date: meeting.specific_date,
    days: meeting.day_code ?? null,
    start_time: meeting.start_time_display ?? null,
    end_time: meeting.end_time_display ?? null,
    location_displayed: meeting.room_code ?? meeting.building_code ?? null,
    instructor: null,
    is_remote: Boolean(meeting.is_remote),
    is_tba: Boolean(meeting.is_tba),
    is_arranged: null,
  };
}

function toComponent(section: PlannerSection) {
  const waitlistCapacity = section.waitlist_capacity ?? null;
  const waitlistAvailable = section.waitlist_available ?? null;
  const waitlistEnrolled = section.waitlist_enrolled ?? null;
  const waitlistShown =
    waitlistCapacity !== null ||
    waitlistAvailable !== null ||
    (waitlistEnrolled !== null && waitlistEnrolled > 0);
  return {
    type: section.instruction_type_name,
    section_code: section.section_code,
    event_id: section.section_id,
    requirement: 'required',
    status: section.status ?? undefined,
    instructors_text: section.instructors.length
      ? section.instructors.join('; ')
      : null,
    meetings: section.meetings.map(toMeeting),
    enrollment: {
      enrolled: section.enrolled ?? null,
      capacity: section.capacity ?? null,
      seats_available: section.seats_available ?? null,
      waitlist: {
        state: waitlistShown ? 'shown' : 'not_shown',
        count: waitlistShown ? waitlistEnrolled : null,
        capacity: waitlistCapacity,
        available_spots: waitlistAvailable,
      },
    },
  };
}

function sectionFamily(sectionCode: string): string {
  const trimmed = sectionCode.trim();
  const parts = trimmed.split('-');
  if (parts.length >= 3) return parts[0]!.toLowerCase();
  return trimmed.toLowerCase();
}

function sectionFamilyIndex(sectionCode: string): string {
  const trimmed = sectionCode.trim();
  const parts = trimmed.split('-');
  if (parts.length >= 3) return `${parts[0]!}-${parts[1]!}`.toLowerCase();
  return trimmed.toLowerCase();
}

/** Group one module's sections into booking choices. See the file header. */
function bookingChoiceGroups(sections: PlannerSection[]): PlannerSection[][] {
  const byPackage = new Map<string, PlannerSection[]>();
  for (const section of sections) {
    for (const packageId of section.event_package_ids ?? []) {
      const members = byPackage.get(packageId) ?? [];
      members.push(section);
      byPackage.set(packageId, members);
    }
  }
  // A bookable combination has one section per instruction type; package ids
  // that repeat a type are planner-internal groupings, not booking choices.
  const validPackages = [...byPackage.values()].filter((members) => {
    const types = members.map((section) => section.instruction_type_name);
    return new Set(types).size === types.length;
  });

  // Linked-event groups: unpackaged sections keyed by FAMILY-INDEX.
  const linkedGroups = new Map<string, PlannerSection[]>();
  for (const section of sections) {
    if ((section.event_package_ids ?? []).length > 0) continue;
    const key = sectionFamilyIndex(section.section_code);
    const members = linkedGroups.get(key) ?? [];
    members.push(section);
    linkedGroups.set(key, members);
  }

  const candidates: PlannerSection[][] = validPackages.map((members) => [
    ...members,
  ]);
  const familyFallback = new Map<string, PlannerSection[]>();
  for (const [key, group] of linkedGroups) {
    const family = sectionFamily(group[0]!.section_code);
    // A group sharing FAMILY-INDEX with packaged sections is a linked extra
    // event and joins every package containing one of those siblings.
    const siblingCandidates = validPackages.flatMap((members, index) =>
      members.some((member) => sectionFamilyIndex(member.section_code) === key)
        ? [candidates[index]!]
        : [],
    );
    if (siblingCandidates.length > 0) {
      for (const members of siblingCandidates) members.push(...group);
      continue;
    }
    const allFamilyPackages = validPackages.filter((members) =>
      members.some((member) => sectionFamily(member.section_code) === family),
    );
    if (allFamilyPackages.length === 0) {
      // No packages anywhere in this family: the family books as one group.
      const members = familyFallback.get(family) ?? [];
      members.push(...group);
      familyFallback.set(family, members);
      continue;
    }
    // Single-member packages carry no combination structure (many are
    // planner-internal id noise), so only multi-member packages anchor.
    const familyPackages = allFamilyPackages.filter(
      (members) => members.length > 1,
    );
    if (familyPackages.length === 0) {
      // Only standalone family packages: the group joins each of them.
      for (const members of allFamilyPackages)
        candidates.push([...members, ...group]);
      continue;
    }
    // Combine with the sections shared by every package of the family (e.g.
    // an overflow lab joins the family lecture that anchors every package).
    const [first, ...rest] = familyPackages;
    const sharedRefs = new Set(
      first!
        .map((member) => member.section_ref)
        .filter((ref) =>
          rest.every((members) =>
            members.some((member) => member.section_ref === ref),
          ),
        ),
    );
    const shared = first!.filter((member) =>
      sharedRefs.has(member.section_ref),
    );
    candidates.push([...shared, ...group]);
  }
  candidates.push(...familyFallback.values());

  const keyed = candidates.map((members) => ({
    members,
    ids: new Set(members.map((section) => section.section_ref)),
  }));
  const groups: PlannerSection[][] = [];
  const seen = new Set<string>();
  for (const candidate of keyed) {
    const isStrictSubset = keyed.some(
      (other) =>
        other.ids.size > candidate.ids.size &&
        [...candidate.ids].every((id) => other.ids.has(id)),
    );
    if (isStrictSubset) continue;
    const key = [...candidate.ids].sort((a, b) => a.localeCompare(b)).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push(
      [...candidate.members].sort((a, b) =>
        a.section_code.localeCompare(b.section_code),
      ),
    );
  }
  return groups.sort((a, b) =>
    a
      .map((section) => section.section_code)
      .join(' + ')
      .localeCompare(b.map((section) => section.section_code).join(' + ')),
  );
}

export type ConvertClassplannerRunOptions = {
  runDirectory: string;
  /** Defaults to `<runDirectory>/tss`. */
  outDirectory?: string;
};

export type ConvertClassplannerRunResult = {
  out: string;
  term: string;
  courses: number;
  booking_choices: number;
  components: number;
  distinct_events: number;
  meetings: number;
  availability_observed_at: string;
};

/** Convert one preserved Class Planner run into `<out>/schedule.json`. */
export async function convertClassplannerRunToTss(
  options: ConvertClassplannerRunOptions,
): Promise<ConvertClassplannerRunResult> {
  const { runDirectory } = options;
  const outDirectory = options.outDirectory ?? join(runDirectory, 'tss');

  const scrape = await readJson<PlannerScrape>(
    join(runDirectory, 'courses.json'),
  );
  const terms = await readJson<PlannerTerms>(join(runDirectory, 'terms.json'));
  const filters = await readJson<PlannerFilters>(
    join(runDirectory, 'filters.json'),
  );

  if (scrape.schema_version !== 'classplanner-catalog-v1')
    throw new Error(`unexpected scrape schema: ${scrape.schema_version}`);
  const term = scrape.term_code;

  const termEntry = terms.terms.find((entry) => entry.term_code === term);
  if (!termEntry) throw new Error(`term ${term} missing from terms.json`);
  // The source formats "2026-08-02 11:24:07+00"; normalize to ISO-8601.
  const availabilityObservedAt = new Date(
    termEntry.last_full_refresh_at,
  ).toISOString();

  // Merge duplicate module entries (topic courses) into one course per module.
  const byModule = new Map<
    string,
    { name: string; sections: PlannerSection[] }
  >();
  for (const course of scrape.courses) {
    const existing = byModule.get(course.module_code);
    if (!existing) {
      byModule.set(course.module_code, {
        name: course.module_name,
        sections: [...course.sections],
      });
      continue;
    }
    existing.sections.push(...course.sections);
    // Deterministic title pick: the entry whose first section code sorts first.
    const firstCode = (sections: PlannerSection[]) =>
      sections
        .map((section) => section.section_code)
        .sort((a, b) => a.localeCompare(b))[0] ?? '';
    if (firstCode(course.sections) < firstCode(existing.sections))
      existing.name = course.module_name;
  }

  const courses = [...byModule.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([moduleCode, { name, sections }]) => {
      const separator = moduleCode.indexOf('-');
      return {
        course_code:
          separator >= 0 ? moduleCode.slice(separator + 1) : moduleCode,
        course_title: name,
        tss_course_code: moduleCode,
        booking_choices: bookingChoiceGroups(sections).map((group, index) => ({
          booking_choice_ordinal: index + 1,
          displayed_package_section: null,
          displayed_package_id: null,
          components: group.map(toComponent),
        })),
      };
    });

  const requestedSubjects = filters.subjects.map((subject) => subject.value);

  const output = {
    schema_version: 'tss-chatbot-v1',
    term,
    requested_course: requestedSubjects.join(', '),
    source_metadata: {
      last_refreshed_displayed: null,
      captured_at: scrape.fetched_at,
      availability_observed_at: availabilityObservedAt,
    },
    coverage: {
      complete: true,
      continuation_needed: false,
      omitted_courses: [],
    },
    courses,
  };

  const sectionRefs = new Set<string>();
  let componentCount = 0;
  let meetingCount = 0;
  for (const course of courses) {
    for (const choice of course.booking_choices) {
      for (const component of choice.components) {
        componentCount += 1;
        sectionRefs.add(component.event_id);
        meetingCount += component.meetings.length;
      }
    }
  }

  await mkdir(outDirectory, { recursive: true });
  const outPath = join(outDirectory, 'schedule.json');
  await writeFile(outPath, JSON.stringify(output, null, 1));

  return {
    out: outPath,
    term,
    courses: courses.length,
    booking_choices: courses.reduce(
      (count, course) => count + course.booking_choices.length,
      0,
    ),
    components: componentCount,
    distinct_events: sectionRefs.size,
    meetings: meetingCount,
    availability_observed_at: availabilityObservedAt,
  };
}
