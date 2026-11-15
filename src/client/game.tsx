import './styles.css';

import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type AttemptResponse, type InitResponse, type Nation, NATIONS } from '../shared/api';
import { CLASSES, type Outcome, playTurn, type Puzzle, type State } from '../shared/engine/rules';
import { WARMUP } from '../shared/trials/warmup';
import { Board } from './components/Board';
import { CLASS_ICON, IconBadge, Moon } from './components/art';
import { HelpSheet, ResultSheet } from './components/Sheets';
import { api } from './lib/api';
import { journey } from './lib/journey';
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

type Mode = 'warmup' | 'daily';

function Play(props: {
  data: InitResponse | null;
  puzzle: Puzzle;
  mode: Mode;
  onData: (d: Partial<Pick<InitResponse, 'me' | 'community'>>) => void;
  onBeginDaily: () => void;
  toast: (m: string) => void;
}) {
  const { puzzle, mode, data } = props;
  const t = useTrial(puzzle);
  const [phase, setPhase] = useState<'plan' | 'striking' | 'result'>('plan');
  const [endState, setEndState] = useState<State | null>(null);
  const [result, setResult] = useState<{ outcome: Outcome; server: AttemptResponse | null } | null>(null);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
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
    setFx({
      attacking: new Set(played.events.map((e) => e.attacker)),
      hitting: new Set(played.events.flatMap((e) => e.hits)),
      bursts: [],
    });
    setPhase('striking');
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
    const server = await req;
    if (server) props.onData({ me: server.me, community: server.community });
    await sleep(720);
    setResult({ outcome: played.outcome, server });
    setPhase('result');
    if (played.outcome.win) journey.end(true, server?.me.tries ?? 1);
  };

  const backToPlan = (keepMoves: boolean) => {
    setResult(null);
    setEndState(null);
    setFx(null);
    setPhase('plan');
    if (!keepMoves) t.reset();
  };

  const onTile = (x: number, y: number) => {
    if (phase !== 'plan') return;
    journey.start();
    const r = t.tap(x, y);
    if (r === 'act' || r === 'wait') journey.progress((t.actions.length + 1) / (puzzle.heroes.length + 1), r);
  };

  const pick = async (n: Nation) => {
    setBusy(true);
    try {
      const fresh = await api.nation(n);
      props.onData({ me: fresh.me, community: fresh.community });
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
      journey.interaction('subscribe');
    } catch (e) {
      props.toast((e as Error).message);
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

  let hint: string | null = null;
  if (planning && mode === 'daily' && sel && !t.committed.acted.includes(sel.id)) {
    const c = CLASSES[sel.cls];
    hint = t.pending
      ? t.targetTiles.length > 0
        ? `${c.ability}: tap a ringed target, or tap the ${c.name} again to stay there.`
        : `Nothing to reach from here. Tap the ${c.name} again to stay, or pick another dot.`
      : t.targetTiles.length > 0
        ? `${c.name}: walk to a gold dot, or use ${c.ability} on a ringed target from here.`
        : `${c.name}: walk to a gold dot. ${c.blurb}`;
  }

  const sub = data
    ? `#${data.day} · ${data.moon} · ${data.feel}${data.isToday ? '' : ' · past trial'}`
    : 'Warm-up · one move';

  return (
    <div className="game">
      <div className="topbar">
        <Moon size={38} />
        <div className="title">
          <div className="wordmark">Forewarned</div>
          <div className="sub">{sub}</div>
        </div>
        {mode === 'daily' && data && (
          <span className="ways-pill" title="Ways the subreddit has found">
            {data.community.ways.length}/{data.community.waysTotal} ways
          </span>
        )}
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
          label={`Trial board, ${puzzle.w} by ${puzzle.h}`}
        />
      </div>

      {hint && <div className="muted" style={{ fontSize: 13, textAlign: 'center', minHeight: 18 }}>{hint}</div>}

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
                {!fallen && !done && <span className="blurb">{CLASSES[h.cls].blurb}</span>}
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
          onJoin={join}
        />
      )}
      {help && <HelpSheet puzzle={puzzle} onClose={() => setHelp(false)} />}
    </div>
  );
}

function App() {
  const [data, setData] = useState<InitResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
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
