import { describe, expect, it } from 'vitest';
import {
  deriveTermLabel,
  discoverTermWindow,
  enumerateCandidateTerms,
} from './termWindow';

function subjectListFetch(inWindowTerms: Set<string>): typeof fetch {
  return ((input: RequestInfo | URL) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const term = new URL(url).searchParams.get('selectedTerm') ?? '';
    const body = inWindowTerms.has(term)
      ? JSON.stringify([
          { code: 'CSE ', value: 'CSE  - Computer Science & Engineering' },
          { code: 'MATH', value: 'MATH - Mathematics' },
        ])
      : JSON.stringify([]);
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as typeof fetch;
}

describe('termWindow', () => {
  it('enumerates candidate term codes per year in chronological order', () => {
    expect(enumerateCandidateTerms([2025, 2026])).toEqual([
      'WI25',
      'SP25',
      'S125',
      'S225',
      'S325',
      'FA25',
      'WI26',
      'SP26',
      'S126',
      'S226',
      'S326',
      'FA26',
    ]);
  });

  it('derives faithful human labels from term codes', () => {
    expect(deriveTermLabel('SP26')).toBe('Spring 2026');
    expect(deriveTermLabel('FA26')).toBe('Fall 2026');
    expect(deriveTermLabel('WI26')).toBe('Winter 2026');
    expect(deriveTermLabel('S126')).toBe('Summer Session I 2026');
    expect(deriveTermLabel('S226')).toBe('Summer Session II 2026');
    expect(deriveTermLabel('FA09')).toBe('Fall 2009');
  });

  it('returns the code unchanged when it does not match the expected shape', () => {
    expect(deriveTermLabel('202603')).toBe('202603');
  });

  it('discovers only terms the source serves, in candidate order', async () => {
    const candidates = enumerateCandidateTerms([2021, 2025, 2026]);
    const inWindow = new Set(['FA25', 'SP26', 'FA26']);

    const descriptors = await discoverTermWindow(candidates, {
      fetch: subjectListFetch(inWindow),
    });

    expect(descriptors).toEqual([
      expect.objectContaining({
        term: 'FA25',
        label: 'Fall 2025',
        subjects: ['CSE', 'MATH'],
      }),
      expect.objectContaining({
        term: 'SP26',
        label: 'Spring 2026',
        subjects: ['CSE', 'MATH'],
      }),
      expect.objectContaining({
        term: 'FA26',
        label: 'Fall 2026',
        subjects: ['CSE', 'MATH'],
      }),
    ]);
  });

  it('treats an empty subject list as not-in-window (e.g. 2021)', async () => {
    const descriptors = await discoverTermWindow(['FA21', 'SP21'], {
      fetch: subjectListFetch(new Set()),
    });
    expect(descriptors).toEqual([]);
  });
});
