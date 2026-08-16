import {
  fetchSubjectListSource,
  type SubjectListSource,
} from './scheduleOfClasses';

type FetchAdapter = typeof fetch;

export type TermDescriptor = {
  term: string;
  label: string;
  subjects?: string[];
  subjectList?: SubjectListSource;
};

// UCSD quarter codes in chronological order within an academic year.
const quarterOrder = ['WI', 'SP', 'S1', 'S2', 'S3', 'FA'] as const;

const quarterLabels: { [code: string]: string } = {
  WI: 'Winter',
  SP: 'Spring',
  S1: 'Summer Session I',
  S2: 'Summer Session II',
  S3: 'Special Summer Session',
  FA: 'Fall',
};

function twoDigitYear(year: number): string {
  return String(year % 100).padStart(2, '0');
}

/**
 * Deterministically enumerate candidate UCSD term codes for the given calendar
 * years (e.g. 2026 -> WI26, SP26, S126, S226, S326, FA26). The Term Window is
 * the subset of these that the live Schedule of Classes actually serves; see
 * {@link discoverTermWindow}.
 */
export function enumerateCandidateTerms(years: number[]): string[] {
  return years.flatMap((year) =>
    quarterOrder.map((quarter) => `${quarter}${twoDigitYear(year)}`),
  );
}

/**
 * Faithful term-code -> human label mapping (e.g. SP26 -> "Spring 2026").
 * Returns the code unchanged when it does not match the expected shape.
 */
export function deriveTermLabel(term: string): string {
  const match = /^(?<quarter>WI|SP|S1|S2|S3|FA)(?<year>\d{2})$/u.exec(term);
  const quarter = match?.groups?.quarter;
  const year = match?.groups?.year;
  if (!quarter || !year) return term;
  return `${quarterLabels[quarter] ?? quarter} 20${year}`;
}

/**
 * Probe the UCSD Schedule of Classes subject-list endpoint for each candidate
 * term and return those that are in the current Term Window (non-empty subject
 * list), in candidate order. No hard-coded term-code map: availability is
 * decided entirely by the source.
 */
export async function discoverTermWindow(
  candidateTerms: string[],
  options: { fetch?: FetchAdapter } = {},
): Promise<TermDescriptor[]> {
  const descriptors: TermDescriptor[] = [];
  for (const term of candidateTerms) {
    const subjectList = await fetchSubjectListSource(term, {
      fetch: options.fetch,
    });
    const codes = subjectList.subjects
      .map((entry) => entry.code.trim())
      .filter((code) => code.length > 0);
    if (codes.length > 0) {
      descriptors.push({
        term,
        label: deriveTermLabel(term),
        subjects: codes,
        subjectList,
      });
    }
  }
  return descriptors;
}
