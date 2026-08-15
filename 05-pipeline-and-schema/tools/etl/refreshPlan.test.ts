import { describe, expect, it } from 'vitest';
import {
  planClassplannerTerms,
  selectPrimaryMetadataDirectory,
} from './refreshPlan';
import type { ClassplannerTermEntry } from '../classplanner-scraper/classplannerCatalog';

function plannerTerm(term: string, courseCount: number): ClassplannerTermEntry {
  return {
    term_code: term,
    course_count: courseCount,
    section_count: courseCount * 3,
    meeting_count: courseCount * 5,
    last_full_refresh_at: '2026-08-02 11:24:07+00',
    configured: true,
  };
}

describe('planClassplannerTerms', () => {
  it('selects planner terms with data outside the Schedule of Classes window', () => {
    const plan = planClassplannerTerms(
      [plannerTerm('FA26', 2109), plannerTerm('WI27', 0)],
      ['S226', 'S326', 'SP26'],
    );
    expect(plan).toEqual([{ term: 'FA26', courseCount: 2109 }]);
  });

  it('fails on a term served by both sources instead of picking one', () => {
    expect(() =>
      planClassplannerTerms([plannerTerm('FA26', 2109)], ['SP26', 'FA26']),
    ).toThrow(/FA26.*Decide the schedule source/su);
  });

  it('ignores planner terms without data', () => {
    expect(planClassplannerTerms([plannerTerm('WI27', 0)], ['SP26'])).toEqual(
      [],
    );
  });
});

describe('selectPrimaryMetadataDirectory', () => {
  const runs = [
    'multi-2026-06-29T08:02:01.606Z-aaaa-SP26',
    'multi-2026-08-03T17:30:51.813Z-bbbb-SP26',
    'multi-2026-08-03T17:30:51.813Z-bbbb-FA25',
    'not-a-run-directory',
  ];

  it('picks the newest normalized run for the Active Planning Term', () => {
    expect(selectPrimaryMetadataDirectory(runs, 'SP26')).toBe(
      'multi-2026-08-03T17:30:51.813Z-bbbb-SP26',
    );
  });

  it('fails when the Active Planning Term has no normalized run', () => {
    expect(() => selectPrimaryMetadataDirectory(runs, 'FA26')).toThrow(
      /No normalized multi-run found.*FA26/su,
    );
  });
});
