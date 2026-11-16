import { describe, expect, it } from 'vitest';
import { dateOfDay } from './engine/generator';
import { choosePick, isSunday, pickTitle, type PickCandidate } from './picks';

const c = (over: Partial<PickCandidate>): PickCandidate => ({ postId: 't3_a', forgeId: 1, score: 2, removed: false, ways: 2, createdMs: 0, ...over });

describe('choosePick', () => {
  it('takes the highest score', () => {
    const pick = choosePick([c({ forgeId: 1, score: 3 }), c({ forgeId: 2, score: 9 }), c({ forgeId: 3, score: 5 })], new Set());
    expect(pick?.forgeId).toBe(2);
  });

  it('needs an upvote beyond the maker’s own', () => {
    expect(choosePick([c({ score: 1 }), c({ score: 0 })], new Set())).toBeNull();
  });

  it('skips removed posts and trials picked before', () => {
    const pick = choosePick([c({ forgeId: 1, score: 9, removed: true }), c({ forgeId: 2, score: 8 }), c({ forgeId: 3, score: 4 })], new Set([2]));
    expect(pick?.forgeId).toBe(3);
  });

  it('breaks ties by more ways, then by the earlier post', () => {
    expect(choosePick([c({ forgeId: 1, ways: 2 }), c({ forgeId: 2, ways: 4 })], new Set())?.forgeId).toBe(2);
    expect(choosePick([c({ forgeId: 1, createdMs: 50 }), c({ forgeId: 2, createdMs: 10 })], new Set())?.forgeId).toBe(2);
  });
});

describe('isSunday', () => {
  it('agrees with the season calendar', () => {
    for (let day = 1; day <= 21; day++) {
      expect(isSunday(day)).toBe(new Date(`${dateOfDay(day).date}T00:00:00Z`).getUTCDay() === 0);
    }
    expect(isSunday(1)).toBe(true); // 15 November 2026 was a Sunday
    expect(isSunday(2)).toBe(false);
  });
});

describe('pickTitle', () => {
  it('names the trial and counts the ways, without the maker’s name', () => {
    expect(pickTitle({ title: 'The Lantern Gate', wayKeys: ['a', 'b'] })).toBe('Foefall community pick: The Lantern Gate · 2 ways');
    expect(pickTitle({ title: '', wayKeys: ['a'] })).toBe('Foefall community pick: Untitled · 1 way');
  });
});
