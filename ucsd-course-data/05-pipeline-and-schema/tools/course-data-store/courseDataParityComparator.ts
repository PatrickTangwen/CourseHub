export type DomainRecord = { [field: string]: unknown };
export type DomainProjection = {
  [category: string]: Map<string, DomainRecord>;
};

type ParityMismatch = {
  category: string;
  identity: string;
  field: string;
  kind: 'missing' | 'extra' | 'changed';
};

export function comparableDomainValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'number' && Number.isNaN(value)) return null;
  if (Array.isArray(value)) return value.map(comparableDomainValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, comparableDomainValue(item)]),
    );
  }
  return value;
}

function equal(left: unknown, right: unknown) {
  return (
    JSON.stringify(comparableDomainValue(left)) ===
    JSON.stringify(comparableDomainValue(right))
  );
}

export function compareCourseDataParity(
  expected: DomainProjection,
  actual: DomainProjection,
  evidenceLimit = 40,
) {
  const mismatches: ParityMismatch[] = [];
  let mismatchCount = 0;
  const report = (mismatch: ParityMismatch) => {
    mismatchCount += 1;
    if (mismatches.length < evidenceLimit) mismatches.push(mismatch);
  };

  for (const category of [
    ...new Set([...Object.keys(expected), ...Object.keys(actual)]),
  ].sort((left, right) => left.localeCompare(right))) {
    const expectedRecords: Map<string, DomainRecord> =
      expected[category] ?? new Map<string, DomainRecord>();
    const actualRecords: Map<string, DomainRecord> =
      actual[category] ?? new Map<string, DomainRecord>();
    for (const identity of [...expectedRecords.keys()].sort((left, right) =>
      left.localeCompare(right),
    )) {
      const expectedRecord = expectedRecords.get(identity);
      const actualRecord = actualRecords.get(identity);
      if (!actualRecord) {
        report({ category, identity, field: 'identity', kind: 'missing' });
        continue;
      }
      for (const field of [
        ...new Set([
          ...Object.keys(expectedRecord ?? {}),
          ...Object.keys(actualRecord),
        ]),
      ].sort((left, right) => left.localeCompare(right))) {
        if (!equal(expectedRecord?.[field], actualRecord[field]))
          report({ category, identity, field, kind: 'changed' });
      }
    }
    for (const identity of [...actualRecords.keys()].sort((left, right) =>
      left.localeCompare(right),
    )) {
      if (!expectedRecords.has(identity))
        report({ category, identity, field: 'identity', kind: 'extra' });
    }
  }

  return {
    matches: mismatchCount === 0,
    mismatchCount,
    mismatches,
    truncated: mismatchCount > mismatches.length,
  };
}
