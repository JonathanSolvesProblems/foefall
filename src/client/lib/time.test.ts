import { describe, expect, it } from 'vitest';
import { untilNextTrial } from './time';

const at = (iso: string) => Date.parse(iso);

describe('untilNextTrial', () => {
  it('counts to 00:01 UTC tomorrow during the day', () => {
    expect(untilNextTrial(at('2026-11-15T23:04:00Z'))).toBe('57 min');
    expect(untilNextTrial(at('2026-11-15T12:00:00Z'))).toBe('12 h 1 min');
  });
  it('counts to 00:01 today in the minute after midnight', () => {
    expect(untilNextTrial(at('2026-11-16T00:00:30Z'))).toBe('1 min');
  });
  it('rolls over to the next day right after the post time', () => {
    expect(untilNextTrial(at('2026-11-16T00:01:00Z'))).toBe('24 h 0 min');
  });
});
