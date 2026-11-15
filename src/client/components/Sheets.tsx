import { showLoginPrompt } from '@devvit/web/client';
import { useState } from 'react';
import {
  type AttemptResponse,
  type Community,
  type InitResponse,
  type Me,
  NATIONS,
  NATION_LIST,
  type Nation,
} from '../../shared/api';
import { waySentences } from '../../shared/describe';
import {
  CLASSES,
  type ClassId,
  MOBS,
  type MobId,
  type Outcome,
  type Puzzle,
} from '../../shared/engine/rules';
import { CLASS_ICON, IconBadge, MOB_ICON } from './art';

function Avatar(props: { src: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  if (!props.src || broken)
    return <span className="avatar">{props.name.charAt(0).toUpperCase()}</span>;
  return (
    <img
      className="avatar"
      src={props.src}
      alt=""
      onError={() => setBroken(true)}
    />
  );
}

export function Codex(props: { community: Community; me: Me }) {
  const { community } = props;
  const locked = Math.max(0, community.waysTotal - community.ways.length);
  return (
    <div className="codex">
      {community.ways.map((w, i) => (
        <div
          key={w.key}
          className={`slot${w.mine ? ' mine' : ''}`}
          title={w.mine ? 'You found this way' : undefined}
        >
          <Avatar src={w.finderAvatar} name={w.finder} />
          <div className="who">
            <div>
              Way {i + 1}
              {w.mine ? ' · yours' : ''}
              <span className="muted"> · {w.count} found</span>
            </div>
            <div className="muted">first: u/{w.finder}</div>
          </div>
        </div>
      ))}
      {Array.from({ length: locked }, (_, i) => (
        <div key={`l${i}`} className="slot locked">
          <span className="avatar">?</span>
          <div className="who">Not yet found</div>
        </div>
      ))}
    </div>
  );
}

/** Today's clears by nation, largest first, with the player's own nation outlined. */
export function NationTally(props: { counts: Record<Nation, number>; mine: Nation | null }) {
  const total = NATION_LIST.reduce((n, k) => n + props.counts[k], 0);
  if (total === 0) return null;
  const order = [...NATION_LIST].sort((a, b) => props.counts[b] - props.counts[a]);
  return (
    <div className="tally" aria-label="Clears by nation today">
      {order.map((n) => (
        <span key={n} className={`tally-chip${props.mine === n ? ' mine' : ''}`} style={{ borderColor: NATIONS[n].color }}>
          <span className="sigil" style={{ background: NATIONS[n].color }}>
            {NATIONS[n].sigil}
          </span>
          {NATIONS[n].short} {props.counts[n]}
        </span>
      ))}
    </div>
  );
}

function NationPicker(props: { onPick: (n: Nation) => void; busy: boolean }) {
  return (
    <>
      <h3>Fight for a nation</h3>
      <p className="muted" style={{ margin: '0 0 8px', fontSize: 14 }}>
        Your nation and streak become your flair here. Every clear adds to your
        nation&apos;s tally.
      </p>
      <div className="nations">
        {NATION_LIST.map((n) => (
          <button
            key={n}
            className="nation"
            disabled={props.busy}
            onClick={() => props.onPick(n)}
          >
            <span className="sigil" style={{ background: NATIONS[n].color }}>
              {NATIONS[n].sigil}
            </span>
            <span>{NATIONS[n].short}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function lossTitle(o: Outcome): string {
  if (o.heroesLost > 0)
    return o.heroesLost > 1 ? 'Your heroes fell' : 'A hero fell';
  if (o.lampsOut > 0) return 'The lamp went out';
  return o.enemiesLeft === 1
    ? 'One still stands'
    : `${o.enemiesLeft} still stand`;
}

export type ResultProps = {
  mode: 'warmup' | 'daily' | 'proof';
  puzzle: Puzzle;
  outcome: Outcome;
  server: AttemptResponse | null;
  data: InitResponse | null;
  busy: boolean;
  onAgain: () => void;
  onAdjust: () => void;
  onBeginDaily: () => void;
  onNation: (n: Nation) => void;
  onChalk: () => void;
  onJoin: () => void;
  onForge?: (() => void) | undefined;
  onPublish?: ((title: string) => Promise<void>) | undefined;
  onBackToForge?: (() => void) | undefined;
  proofWays?: number | undefined;
};

/** After clearing your own trial: name it and post it, or go back and change it. */
function ProofSheet(p: ResultProps) {
  const [title, setTitle] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loggedIn = !!p.data?.me.username;
  const post = async () => {
    if (!p.onPublish) return;
    setPosting(true);
    setError(null);
    try {
      await p.onPublish(title);
    } catch (e) {
      setError((e as Error).message);
      setPosting(false);
    }
  };
  if (!p.outcome.win) {
    return (
      <div className="sheet-backdrop">
        <div className="sheet" role="dialog" aria-label="Result">
          <h2>{lossTitle(p.outcome)}</h2>
          <p className="lede">Your own trial bested you. Adjust your moves, or go back and change the board.</p>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={p.onAdjust}>
              Adjust moves
            </button>
            <button className="btn" onClick={p.onBackToForge}>
              Back to building
            </button>
          </div>
        </div>
      </div>
    );
  }
  const ways = p.proofWays ?? 1;
  return (
    <div className="sheet-backdrop">
      <div className="sheet" role="dialog" aria-label="Post your trial">
        <h2 className="wordmark">Proven</h2>
        <p className="lede">
          {ways === 1
            ? 'You cleared it, and there is exactly one way through. Post it and see who else finds it.'
            : `You cleared it, and it can be won ${ways} ways. Post it and the subreddit will hunt for every one.`}
        </p>
        {loggedIn ? (
          <>
            <label className="field">
              <span>Name your trial (optional)</span>
              <input value={title} maxLength={40} placeholder="The Lantern Gate" onChange={(e) => setTitle(e.target.value)} />
            </label>
            {error && <p className="error-line">{error}</p>}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" disabled={posting} onClick={post}>
                {posting ? 'Posting…' : 'Post it'}
              </button>
              <button className="btn" disabled={posting} onClick={p.onBackToForge}>
                Back to building
              </button>
            </div>
          </>
        ) : (
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => showLoginPrompt()}>
              Log in to post it
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ResultSheet(p: ResultProps) {
  const { outcome } = p;
  if (p.mode === 'proof') return <ProofSheet {...p} />;
  if (p.mode === 'warmup') {
    return (
      <div className="sheet-backdrop">
        <div className="sheet" role="dialog" aria-label="Result">
          {outcome.win ? (
            <>
              <h2 className="wordmark">That is the whole game</h2>
              <p className="lede">
                Make every strike land on a monster. Keep your heroes and lamps
                out of the red. A new trial rises with the moon each day, and
                the subreddit hunts every way to win it.
              </p>
              <div className="row" style={{ marginTop: 16 }}>
                <button className="btn primary" onClick={p.onBeginDaily}>
                  Begin today&apos;s trial
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>{lossTitle(outcome)}</h2>
              <p className="lede">
                Shove the Wolf one step toward the Boar, so each one&apos;s
                strike lands on the other.
              </p>
              <div className="row" style={{ marginTop: 16 }}>
                <button className="btn primary" onClick={p.onAgain}>
                  Try again
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const me = p.server?.me ?? p.data?.me ?? null;
  const community = p.server?.community ?? p.data?.community ?? null;
  const total = community?.waysTotal ?? 0;
  const mineCount = me?.ways.length ?? 0;
  const wayIndex = community
    ? community.ways.findIndex((w) => w.key === outcome.wayKey) + 1
    : 0;

  if (!outcome.win) {
    return (
      <div className="sheet-backdrop">
        <div className="sheet" role="dialog" aria-label="Result">
          <h2>{lossTitle(outcome)}</h2>
          <p className="lede">
            Every strike shows before it lands. Read the red tiles again: a
            monster that is struck falls, so make them strike each other.
          </p>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={p.onAdjust}>
              Adjust moves
            </button>
            <button className="btn" onClick={p.onAgain}>
              Start over
            </button>
          </div>
          {me && me.tries > 0 && (
            <p className="muted" style={{ textAlign: 'center', fontSize: 13 }}>
              Tries today: {me.tries}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="sheet-backdrop">
      <div className="sheet" role="dialog" aria-label="Result">
        <h2 className="wordmark">The field is clear</h2>
        <p className="lede">
          {p.server && !p.server.saved
            ? p.server.firstFinder
              ? 'Nobody has claimed this way yet. Log in and win it again to put your name on it.'
              : 'A way through.'
            : p.server?.firstFinder
              ? 'Nobody in the subreddit had found this way. It carries your name now.'
              : p.server && !p.server.newForMe
                ? 'You have won this way before. Another way is out there.'
                : wayIndex > 0
                  ? `Way ${wayIndex} of ${total} the subreddit knows.`
                  : 'A way through.'}
        </p>
        {p.server?.firstFinder && p.server.saved && (
          <span className="badge-first">First to find it</span>
        )}
        <ul className="way-lines">
          {waySentences(outcome.wayKey, p.puzzle).map((s) => (
            <li key={s}>{s}.</li>
          ))}
        </ul>
        {me && p.server?.saved !== false && (
          <div className="stat-row">
            <div className="stat">
              <b>{me.tries || 1}</b>
              <span>tries today</span>
            </div>
            <div className="stat">
              <b>
                {mineCount}/{total}
              </b>
              <span>your ways</span>
            </div>
            <div className="stat">
              <b>{me.streak}</b>
              <span>day streak</span>
            </div>
          </div>
        )}
        {p.server && !p.server.saved && (
          <div style={{ textAlign: 'center', marginTop: 6 }}>
            <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
              You are not logged in, so this clear is not saved. Log in to keep
              your streak and put your name on the ways you find.
            </p>
            <button className="btn" onClick={() => showLoginPrompt()}>
              Log in to Reddit
            </button>
          </div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          {mineCount < total && (
            <button className="btn primary" onClick={p.onAgain}>
              Hunt another way
            </button>
          )}
          {p.server?.saved && (
            <button className="btn" disabled={p.busy} onClick={p.onChalk}>
              Leave a chalk mark
            </button>
          )}
        </div>
        {community && (
          <>
            <h3>
              The hunt: {community.ways.length} of {total} ways found
            </h3>
            <Codex community={community} me={me ?? emptyMe} />
          </>
        )}
        {community && (
          <>
            {Object.values(community.nations).some((v) => v > 0) && <h3>The nations today</h3>}
            <NationTally counts={community.nations} mine={me?.nation ?? null} />
          </>
        )}
        {p.server?.saved && me && !me.nation && (
          <NationPicker onPick={p.onNation} busy={p.busy} />
        )}
        {p.onForge && (
          <>
            <h3>Make one for the subreddit</h3>
            <p className="muted" style={{ margin: '0 0 8px', fontSize: 14 }}>
              Build your own trial. Clear it to prove it can be won, then post it for everyone to hunt.
            </p>
            <div className="row">
              <button className="btn" onClick={p.onForge}>
                Build a trial
              </button>
            </div>
          </>
        )}
        {community && community.board.length > 0 && (
          <>
            <h3>First to clear today</h3>
            <ol className="board-list">
              {community.board.slice(0, 5).map((r, i) => (
                <li key={r.name}>
                  <span className="rank">{i + 1}</span>
                  <Avatar src={r.avatar} name={r.name} />
                  <span className="nm">u/{r.name}</span>
                  <span className="muted">
                    {r.tries === 1 ? 'first try' : `${r.tries} tries`} ·{' '}
                    {r.ways} {r.ways === 1 ? 'way' : 'ways'}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
        {p.server?.saved && (
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn ghost" disabled={p.busy} onClick={p.onJoin}>
              Join r/{p.data?.subreddit ?? 'the trials'} for tomorrow&apos;s
              trial
            </button>
          </div>
        )}
        {mineCount >= total && (
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={p.onAgain}>
              Play it again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const emptyMe: Me = {
  username: null,
  tries: 0,
  solved: false,
  ways: [],
  streak: 0,
  best: 0,
  nation: null,
  firstVisit: false,
};

export function HelpSheet(props: { onClose: () => void; puzzle: Puzzle }) {
  const mobs = [...new Set(props.puzzle.enemies.map((e) => e.mob))] as MobId[];
  const classes = props.puzzle.heroes.map((h) => h.cls) as ClassId[];
  const allMobs = (Object.keys(MOBS) as MobId[]).filter(
    (m) => !mobs.includes(m)
  );
  return (
    <div className="sheet-backdrop" onClick={props.onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label="How to play"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="sheet-close"
          aria-label="Close help"
          onClick={props.onClose}
        >
          ×
        </button>
        <h2 className="wordmark">How to play</h2>
        <p className="lede">
          Every monster shows the tiles it will strike. Move each hero once and
          use its ability. Then press Strike: every monster strikes at the same
          moment. Win when every monster falls, no hero is struck and every lamp
          stays lit.
        </p>
        <h3>Your heroes today</h3>
        <div className="help-grid">
          {classes.map((c) => (
            <div key={c} className="help-item">
              <IconBadge name={CLASS_ICON[c]} ring="#d9b66b" fill="#f1d590" />
              <div>
                <span className="t">{CLASSES[c].name}</span> ·{' '}
                {CLASSES[c].ability} · walks {CLASSES[c].move}
                <div className="muted">{CLASSES[c].blurb}</div>
              </div>
            </div>
          ))}
        </div>
        <h3>The monsters</h3>
        <div className="help-grid">
          {[...mobs, ...allMobs].map((m) => (
            <div
              key={m}
              className="help-item"
              style={{ opacity: mobs.includes(m) ? 1 : 0.6 }}
            >
              <IconBadge name={MOB_ICON[m]} ring="#d1543f" fill="#efe6d2" />
              <div>
                <span className="t">{MOBS[m].name}</span> · {MOBS[m].attack}
                <div className="muted">{MOBS[m].blurb}</div>
              </div>
            </div>
          ))}
        </div>
        <h3>Small print</h3>
        <p className="muted" style={{ fontSize: 14, margin: 0 }}>
          A creature shoved into rock, a lamp or another creature takes 1.
          Shoved or dragged over a chasm, it falls. Monsters with two red pips
          need two hits. Undo is free; only Strike counts as a try.
        </p>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={props.onClose}>
            Back to the trial
          </button>
        </div>
        <p className="credits">
          A daily trial from the world of Orvandel. Icons by Lorc, Delapouite,
          Caro Asercion and DarkZaitzev from game-icons.net (CC BY 3.0).
          Cormorant Unicase and Alegreya Sans (SIL Open Font License).
        </p>
      </div>
    </div>
  );
}
