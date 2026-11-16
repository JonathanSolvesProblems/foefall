// The Sunday community pick: the week's best-liked trial built by a redditor goes up again as its own post, so the
// subreddit's best work reaches everyone who missed it. The rules live here so they can be tested without Reddit.
import { EPOCH_UTC } from './engine/generator';
import type { ForgedTrial } from './game';

const DAY_MS = 86_400_000;

/** A player-built post, as the picker sees it. */
export type PickCandidate = {
  postId: string;
  forgeId: number;
  /** Reddit score. A new post starts at 1 from its author's own upvote. */
  score: number;
  removed: boolean;
  ways: number;
  createdMs: number;
};

/** At least one upvote from someone other than the maker. */
export const PICK_MIN_SCORE = 2;

/** The window the pick is chosen from: the seven days before the Sunday it goes up. */
export const PICK_WINDOW_MS = 7 * DAY_MS;

export function isSunday(day: number): boolean {
  return new Date(EPOCH_UTC + (day - 1) * DAY_MS).getUTCDay() === 0;
}

/**
 * The highest-scoring trial that is still up, has reached the minimum score and has not been picked before. Ties go to
 * the trial with more ways to hunt, then to the one posted first.
 */
export function choosePick(candidates: PickCandidate[], alreadyPicked: ReadonlySet<number>): PickCandidate | null {
  const eligible = candidates.filter((c) => !c.removed && c.score >= PICK_MIN_SCORE && !alreadyPicked.has(c.forgeId));
  eligible.sort((a, b) => b.score - a.score || b.ways - a.ways || a.createdMs - b.createdMs);
  return eligible[0] ?? null;
}

/**
 * The pick's post title. It does not name the maker: a post title cannot be edited, so a name in it would outlive the
 * maker deleting their account. The card inside the post credits them, from a record that expires.
 */
export function pickTitle(f: Pick<ForgedTrial, 'title' | 'wayKeys'>): string {
  const ways = f.wayKeys.length;
  return `Foefall community pick: ${f.title || 'Untitled'} · ${ways} ${ways === 1 ? 'way' : 'ways'}`;
}
