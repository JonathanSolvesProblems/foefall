import './styles.css';

import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type AttemptResponse, type InitResponse, type Nation, NATIONS } from '../shared/api';
import { navigateTo } from '@devvit/web/client';
import { type Action, CLASSES, type Outcome, playTurn, type Puzzle, type State } from '../shared/engine/rules';
import { findNudge, type Nudge } from '../shared/nudge';
import { WARMUP } from '../shared/trials/warmup';
import { Board } from './components/Board';
import { EMPTY_FORGE, ForgeEditor } from './components/ForgeEditor';
import { CLASS_ICON, IconBadge, Moon } from './components/art';
import { HelpSheet, ResultSheet } from './components/Sheets';
import { api } from './lib/api';
import { journey } from './lib/journey';
import { sfx } from './lib/sfx';
import { useTrial } from './lib/useTrial';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2600);
  }, []);
  return { msg, show };
}

type Mode = 'warmup' | 'daily' | 'proof';

function Play(props: {
  data: InitResponse | null;
  puzzle: Puzzle;
  mode: Mode;
  onData: (d: Partial<Pick<InitResponse, 'me' | 'community'>>) => void;
  onBeginDaily: () => void;
  toast: (m: string) => void;
  onForge?: (() => void) | undefined;
  onPublish?: ((actions: Action[], title: string) => Promise<void>) | undefined;
  onBackToForge?: (() => void) | undefined;
  proofWays?: number | undefined;
}) {
  const { puzzle, mode, data } = props;
  const t = useTrial(puzzle);
  const [phase, setPhase] = useState<'plan' | 'striking' | 'result'>('plan');
  const [endState, setEndState] = useState<State | null>(null);
  const [result, setResult] = useState<{ outcome: Outcome; server: AttemptResponse | null } | null>(null);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  // Ways found when the player last left a chalk mark here (null: use the server's count), and whether they joined.
  const [chalkedAt, setChalkedAt] = useState<number | null>(null);
  const [joined, setJoined] = useState(false);
  // Failed strikes this session, and the first step shown to a stuck player (see shared/nudge.ts).
  const [fails, setFails] = useState(0);
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [nudging, setNudging] = useState(false);
  const [muted, setMuted] = useState(sfx.isMuted());
  // A player who has not tried this trial yet hears about the hunt once, until their first tap.
  const [intro, setIntro] = useState(mode === 'daily' && !!data && data.me.tries === 0 && !data.me.solved);
  const [fx, setFx] = useState<{
    attacking: Set<string>;
    hitting: Set<string>;
    bursts: { id: string; x: number; y: number; hero: boolean }[];
  } | null>(null);

  useEffect(() => {
    t.setSelected(puzzle.heroes[0]?.id ?? null);
    // Selecting the first hero on load is part of onboarding: the walkable tiles are visible before the first tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle]);

  const strike = async () => {
    if (phase !== 'plan') return;
    const played = playTurn(puzzle, t.actions);
    if (!played) return;
    journey.start();
    journey.interaction('strike', `${t.actions.length}`);
    setIntro(false); // the opening line has done its job once a turn is played
    setFx({
      attacking: new Set(played.events.map((e) => e.attacker)),
      hitting: new Set(played.events.flatMap((e) => e.hits)),
      bursts: [],
    });
    setPhase('striking');
    sfx.strike();
    const req = mode === 'daily' ? api.attempt(t.actions).catch((e: Error) => (props.toast(e.message), null)) : Promise.resolve(null);
    await sleep(820);
    const before = new Set([...t.committed.fallen.map((f) => f.id), ...t.committed.lost.map((l) => l.id)]);
    setFx({
      attacking: new Set(),
      hitting: new Set(),
      bursts: [
        ...played.end.fallen.filter((f) => !before.has(f.id)).map((f) => ({ id: f.id, x: f.x, y: f.y, hero: false })),
        ...played.end.lost.filter((l) => !before.has(l.id)).map((l) => ({ id: l.id, x: l.x, y: l.y, hero: true })),
      ],
    });
    setEndState(played.end);
    played.end.fallen.filter((f) => !before.has(f.id)).forEach((_, i) => sfx.fall(i));
    const server = await req;
    if (server) props.onData({ me: server.me, community: server.community });
    await sleep(720);
    setResult({ outcome: played.outcome, server });
    setPhase('result');
    if (played.outcome.win) setNudge(null);
    else setFails((f) => f + 1);
    if (played.outcome.win) sfx.win();
    else sfx.lose();
    if (played.outcome.win && mode !== 'proof') journey.end(true, server?.me.tries ?? 1);
  };

  const backToPlan = (keepMoves: boolean) => {
    setResult(null);
    setEndState(null);
    setFx(null);
    setPhase('plan');
    if (!keepMoves) t.reset();
  };

  // Solving can take a second on a phone for the hardest days, so paint "Finding…" first, then start over with the
  // first step marked on the board.
  const askNudge = () => {
    setNudging(true);
    window.setTimeout(() => {
      const n = findNudge(puzzle, data?.me.ways ?? []);
      setNudging(false);
      if (!n) return props.toast('No first step to show for this trial.');
      setNudge(n);
      journey.interaction('nudge');
      backToPlan(false);
      t.setSelected(n.hero);
    }, 40);
  };
  const offerNudge = mode === 'daily' && (fails >= 3 || (data?.me.tries ?? 0) >= 3);

  const onTile = (x: number, y: number) => {
    if (phase !== 'plan') return;
    journey.start();
    setIntro(false);
    const r = t.tap(x, y);
    if (r === 'select') sfx.select();
    else if (r === 'move') sfx.step();
    else if (r === 'act') sfx.ability();
    else if (r === 'wait') sfx.select();
    if (r === 'act' || r === 'wait') journey.progress((t.actions.length + 1) / (puzzle.heroes.length + 1), r);
  };

  const pick = async (n: Nation) => {
    setBusy(true);
    try {
      const fresh = await api.nation(n);
      props.onData({ me: fresh.me, community: fresh.community });
      // The open win card reads the strike's own copy of the player: update it too, or the picker stays up.
      setResult((r) => (r?.server ? { ...r, server: { ...r.server, me: fresh.me, community: fresh.community } } : r));
      props.toast(`You fight for ${NATIONS[n].name}. Your flair is set.`);
    } catch (e) {
      props.toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const chalk = async () => {
    setBusy(true);
    try {
      props.toast((await api.chalk()).message);
      setChalkedAt(result?.server?.me.ways.length ?? data?.me.ways.length ?? 0);
      journey.interaction('chalk_mark');
    } catch (e) {
      props.toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const join = async () => {
    setBusy(true);
    try {
      props.toast((await api.subscribe()).message);
      setJoined(true);
      journey.interaction('subscribe');
    } catch {
      // Reddit only lets an app subscribe a player once the app is approved. Until then, take them to the subreddit,
      // where Reddit's own Join button is one tap away.
      const sub = data?.subreddit;
      if (sub) {
        props.toast(`Opening r/${sub}. Tap Join there.`);
        navigateTo(`https://www.reddit.com/r/${sub}/`);
      } else props.toast('Could not join right now.');
    } finally {
      setBusy(false);
    }
  };

  const showState = endState ?? t.display;
  const planning = phase === 'plan';
  const sel = t.selected ? puzzle.heroes.find((h) => h.id === t.selected) : undefined;
  const enemiesTotal = puzzle.enemies.length;
  const willFall = t.predicted.fallen.length;
  const heroesHit = t.predicted.lost.length;
  const lampsOut = t.outcome.lampsOut;
  const perfect = t.outcome.win;

  let coach: string | null = null;
  if (mode === 'warmup' && planning) {
    if (t.actions.length > 0) coach = perfect ? 'Both strikes now land on a monster. Press Strike.' : 'Not quite. Undo and try another tile.';
    else if (t.pending && t.targetTiles.length > 0) coach = 'Now tap the ringed Wolf to shove it into the Boar.';
    else if (t.selected) coach = 'Red tiles are where the monsters strike. Walk to a gold dot beside the Wolf, on its left.';
    else coach = 'Tap your Vanguard.';
  }
  if (!coach && intro && planning && data) {
    const n = data.community.waysTotal;
    const found = data.community.ways.length;
    const ways = n === 1 ? 'one way' : `${n} ways`;
    coach = data.forge
      ? `u/${data.forge.author} built this one. It can be won ${ways}: find one, then hunt the rest.`
      : found >= n && n > 0
        ? `This trial can be won ${ways}, and r/${data.subreddit} has found every one. Can you?`
        : `This trial can be won ${ways}. Win it any way you can, then hunt the rest with r/${data.subreddit}${found ? ` (${found} found so far)` : ''}.`;
  }

  let hint: string | null = null;
  if (planning && mode !== 'warmup' && sel && !t.committed.acted.includes(sel.id)) {
    const c = CLASSES[sel.cls];
    hint = t.pending
      ? t.targetTiles.length > 0
        ? `${c.ability}: tap a ringed target, or tap the ${c.name} again to stay there.`
        : `Nothing to reach from here. Tap the ${c.name} again to stay, or pick another dot.`
      : t.targetTiles.length > 0
        ? `${c.name}: walk to a gold dot, or use ${c.ability} on a ringed target from here.`
        : `${c.name}: walk to a gold dot. ${c.blurb}`;
  }
  // A nudge shows until its hero has acted; its words replace the hint unless another hero is selected.
  const nudgeLive = planning && nudge && !t.committed.acted.includes(nudge.hero) ? nudge : null;
  if (nudgeLive && (!sel || sel.id === nudgeLive.hero)) hint = nudgeLive.text;

  const sub =
    mode === 'proof'
      ? 'Prove your trial: clear it yourself'
      : data?.forge
        ? `Built by u/${data.forge.author}${data.forge.title ? ` · ${data.forge.title}` : ''}`
        : data
          ? `#${data.day} · ${data.moon} · ${data.feel}${data.isToday ? '' : ' · past trial'}`
          : 'Warm-up · one move';

  return (
    <div className="game">
      <div className="topbar">
        <Moon size={38} />
        <div className="title">
          <div className="wordmark">Foefall</div>
          <div className="sub">{sub}</div>
        </div>
        {mode === 'daily' && data && (
          <span className="ways-pill" title="Ways the subreddit has found">
            {data.community.ways.length}/{data.community.waysTotal} ways
          </span>
        )}
        <button
          className="icon-btn"
          aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
          aria-pressed={!muted}
          onClick={() => {
            sfx.setMuted(!muted);
            setMuted(!muted);
            if (muted) sfx.select();
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
            {muted ? (
              <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            )}
          </svg>
        </button>
        <button className="icon-btn" aria-label="How to play" onClick={() => (setHelp(true), journey.interaction('help'))}>
          ?
        </button>
      </div>

      {coach ? (
        <div className="coach">{coach}</div>
      ) : (
        <div className={`forecast${perfect && planning ? ' perfect' : ''}`} aria-live="polite">
          {perfect && planning ? (
            <span>Every strike lands true. Press Strike.</span>
          ) : (
            <>
              <span className={willFall === enemiesTotal ? 'good' : ''}>
                {willFall}/{enemiesTotal} monsters fall
              </span>
              <span className={heroesHit ? 'bad' : 'good'}>{heroesHit ? `${heroesHit} hero struck` : 'Heroes safe'}</span>
              {puzzle.lamps.length > 0 && <span className={lampsOut ? 'bad' : 'good'}>{lampsOut ? 'Lamp goes out' : 'Lamp lit'}</span>}
            </>
          )}
        </div>
      )}

      <div className="board-slot">
        <div className="board-wrap">
          <Board
            puzzle={puzzle}
            state={showState}
            strikes={phase === 'result' || endState ? [] : t.strikes}
            doomed={planning ? t.doomed : new Set()}
            danger={planning ? t.danger : new Set()}
            selected={planning ? t.selected : null}
            moveTiles={planning ? t.moveTiles : []}
            targetTiles={planning ? t.targetTiles : []}
            striking={phase === 'striking' && !endState}
            attacking={fx?.attacking}
            hitting={fx?.hitting}
            bursts={fx?.bursts}
            onTile={onTile}
            nudge={nudgeLive}
            label={`Trial board, ${puzzle.w} by ${puzzle.h}`}
          />
        </div>
      </div>

      {/* Always present outside the warm-up, so the board above does not move when a hint comes or goes. */}
      {mode !== 'warmup' && <div className="hint muted">{hint}</div>}

      <div className="heroes">
        {puzzle.heroes.map((h) => {
          const done = t.committed.acted.includes(h.id);
          const fallen = t.committed.lost.some((l) => l.id === h.id);
          return (
            <button
              key={h.id}
              className={`hero-card${t.selected === h.id ? ' selected' : ''}${done || fallen ? ' done' : ''}`}
              disabled={!planning || done || fallen}
              onClick={() => t.setSelected(h.id)}
            >
              <IconBadge name={CLASS_ICON[h.cls]} ring="#d9b66b" fill="#f1d590" dim={done || fallen} />
              <span style={{ minWidth: 0 }}>
                <span className="name">{CLASSES[h.cls].name}</span>
                <span className="ability" style={{ display: 'block' }}>
                  {fallen ? 'Fallen' : done ? 'Done' : CLASSES[h.cls].ability}
                </span>
                {/* Kept when the hero is done (the card dims), so the card keeps its height and the board does not move. */}
                <span className="blurb">{CLASSES[h.cls].blurb}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="actions">
        <button className="btn" disabled={!planning || (t.actions.length === 0 && !t.pending)} onClick={() => (t.undo(), journey.interaction('undo'))}>
          Undo
        </button>
        <button className="btn" disabled={!planning || !sel || t.committed.acted.includes(sel.id)} onClick={t.wait}>
          Wait
        </button>
        <button className={`btn primary${perfect && planning ? ' ready' : ''}`} disabled={!planning} onClick={strike}>
          Strike
        </button>
      </div>

      {phase === 'result' && result && (
        <ResultSheet
          mode={mode}
          puzzle={puzzle}
          outcome={result.outcome}
          server={result.server}
          data={data}
          busy={busy}
          onAgain={() => backToPlan(false)}
          onAdjust={() => backToPlan(true)}
          onBeginDaily={props.onBeginDaily}
          onNation={pick}
          onChalk={chalk}
          chalkedAt={chalkedAt}
          onJoin={join}
          joined={joined}
          onForge={props.onForge}
          onPublish={props.onPublish ? (title: string) => props.onPublish!(t.actions, title) : undefined}
          onBackToForge={props.onBackToForge}
          proofWays={props.proofWays}
          onNudge={offerNudge ? askNudge : undefined}
          nudging={nudging}
        />
      )}
      {help && <HelpSheet puzzle={puzzle} onClose={() => setHelp(false)} />}
    </div>
  );
}

const DRAFT_KEY = 'forewarned:forgeDraft';

function loadDraft(): Puzzle {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return { ...EMPTY_FORGE, ...(JSON.parse(raw) as Partial<Puzzle>), id: 'forge' };
  } catch {
    /* no storage: start blank */
  }
  return EMPTY_FORGE;
}

function saveDraft(p: Puzzle) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(p));
  } catch {
    /* no storage: the draft lives only in memory */
  }
}

function App() {
  const [data, setData] = useState<InitResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [view, setView] = useState<'play' | 'forge'>('play');
  const [draft, setDraft] = useState<Puzzle>(loadDraft);
  const [proofWays, setProofWays] = useState(0);
  const toast = useToast();

  useEffect(() => {
    journey.ready();
    api
      .init()
      .then((d) => {
        setData(d);
        setMode(d.me.firstVisit && !d.me.solved ? 'warmup' : 'daily');
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  const merge = useCallback((d: Partial<Pick<InitResponse, 'me' | 'community'>>) => {
    setData((prev) => (prev ? { ...prev, ...d } : prev));
  }, []);

  const beginDaily = () => {
    setMode('daily');
    api.seen().catch(() => undefined);
    journey.interaction('warmup_done');
  };

  const changeDraft = (p: Puzzle) => {
    setDraft(p);
    saveDraft(p);
  };
  const openForge = () => {
    setView('forge');
    journey.interaction('forge_open');
  };
  const publish = async (actions: Action[], title: string) => {
    const res = await api.forge(draft, actions, title);
    journey.interaction('forge_posted');
    changeDraft(EMPTY_FORGE);
    toast.show('Your trial is posted. Opening it now.');
    navigateTo(res.url);
  };

  let body;
  if (err) {
    body = (
      <div className="center-msg">
        <Moon size={80} />
        <p>The moon is clouded over: {err}</p>
        <button className="btn primary" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    );
  } else if (!data || !mode) {
    body = (
      <div className="center-msg">
        <Moon size={80} />
        <p className="muted">Reading the omens…</p>
      </div>
    );
  } else if (view === 'forge') {
    body = (
      <ForgeEditor
        initial={draft}
        onChange={changeDraft}
        onExit={() => setView('play')}
        onProve={(p, ways) => {
          changeDraft(p);
          setProofWays(ways);
          setMode('proof');
          setView('play');
        }}
      />
    );
  } else if (mode === 'proof') {
    body = (
      <Play
        key={`proof-${JSON.stringify(draft)}`}
        data={data}
        puzzle={draft}
        mode="proof"
        onData={() => undefined}
        onBeginDaily={beginDaily}
        toast={toast.show}
        proofWays={proofWays}
        onPublish={publish}
        onBackToForge={() => {
          setMode('daily');
          setView('forge');
        }}
      />
    );
  } else {
    body = (
      <Play
        key={mode}
        data={mode === 'daily' ? data : null}
        puzzle={mode === 'daily' ? data.puzzle : WARMUP}
        mode={mode}
        onData={merge}
        onBeginDaily={beginDaily}
        toast={toast.show}
        onForge={data.me.username ? openForge : undefined}
      />
    );
  }

  return (
    <>
      <div className="sky" />
      {body}
      {toast.msg && <div className="toast">{toast.msg}</div>}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
