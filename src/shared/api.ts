import type { TierId } from './engine/generator';
import type { Action, Puzzle } from './engine/rules';

export type Nation = 'concord' | 'wildmark' | 'embered' | 'tidebound';

export const NATIONS: Record<Nation, { name: string; short: string; color: string; glow: string; sigil: string }> = {
  concord: { name: 'The Aurelian Concord', short: 'Concord', color: '#e8b84f', glow: '#ffd88a', sigil: '☀' },
  wildmark: { name: 'The Wildmark Compact', short: 'Wildmark', color: '#8fcf6a', glow: '#c9f28a', sigil: '❦' },
  embered: { name: 'The Embered Throne', short: 'Embered', color: '#ec6a42', glow: '#ff9c5a', sigil: '♨' },
  tidebound: { name: 'The Tidebound Court', short: 'Tidebound', color: '#4fc8c0', glow: '#8ff0e6', sigil: '≈' },
};

export const NATION_LIST: readonly Nation[] = ['concord', 'wildmark', 'embered', 'tidebound'];

/** A way the subreddit has found. Unfound ways are only counted, never sent. */
export type FoundWay = {
  key: string;
  finder: string;
  finderAvatar: string | null;
  /** How many redditors have won this way. */
  count: number;
  mine: boolean;
};

export type Me = {
  username: string | null;
  tries: number;
  solved: boolean;
  /** Way keys this player has won today. */
  ways: string[];
  streak: number;
  best: number;
  nation: Nation | null;
  /** True until the player finishes or skips the warm-up once. */
  firstVisit: boolean;
  /** How many ways the player had found when they last left a chalk mark on this post (0: none yet). */
  chalked: number;
  /** The try the player first cleared this trial on (0: not cleared). Tries keep counting while they hunt more ways. */
  clearTry: number;
};

export type BoardRow = { name: string; avatar: string | null; tries: number; ways: number };

export type Community = {
  players: number;
  solvers: number;
  waysTotal: number;
  ways: FoundWay[];
  nations: Record<Nation, number>;
  board: BoardRow[];
};

export type InitResponse = {
  type: 'init';
  day: number;
  date: string;
  tier: TierId;
  moon: string;
  feel: string;
  /** False on an older day's post: it can be played, but it does not count toward a streak. */
  isToday: boolean;
  today: number;
  subreddit: string;
  puzzle: Puzzle;
  me: Me;
  community: Community;
  /** Set when this post holds a trial a redditor forged, rather than the day's trial. */
  forge: { id: number; title: string; author: string; pick?: boolean } | null;
};

export type AttemptRequest = { actions: Action[] };

export type AttemptResponse = {
  type: 'attempt';
  win: boolean;
  wayKey: string;
  /** This player had not won this way before. */
  newForMe: boolean;
  /** Nobody in the subreddit had found this way before. */
  firstFinder: boolean;
  /** Not logged in: the result is shown but not saved. */
  saved: boolean;
  me: Me;
  community: Community;
};

export type NationRequest = { nation: Nation };
export type ForgeRequest = { puzzle: Puzzle; proof: Action[]; title: string };
export type ForgeResponse = { type: 'forge'; id: number; postId: string; url: string };
export type OkResponse = { type: 'ok'; message: string };
export type ErrorResponse = { type: 'error'; message: string };
