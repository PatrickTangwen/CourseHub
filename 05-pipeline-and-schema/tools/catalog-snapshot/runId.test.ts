import { describe, expect, it } from 'vitest';
import { filesystemSafeTimestamp } from './runId';

describe('filesystemSafeTimestamp', () => {
  it('removes characters forbidden in Windows path components', () => {
    expect(filesystemSafeTimestamp('2026-08-13T11:00:06.839Z')).toBe(
      '2026-08-13T11-00-06.839Z',
    );
  });
});
