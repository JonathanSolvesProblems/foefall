import './styles.css';
import './splash.css';

import { requestExpandedMode } from '@devvit/web/client';
import { type MouseEvent, StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type InitResponse, NATIONS, NATION_LIST } from '../shared/api';
import { forecast, initialState } from '../shared/engine/rules';
import { Board } from './components/Board';
import { Moon } from './components/art';
import { api } from './lib/api';

/** "Sunday, November 15" for a trial's UTC date (YYYY-MM-DD), the day it was posted for. */
function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function Splash() {
  const [data, setData] = useState<InitResponse | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    api
      .init()
      .then(setData)
      .catch(() => setErr(true));
  }, []);

  const preview = useMemo(() => {
    if (!data) return null;
    const s = initialState(data.puzzle);
    return { s, strikes: forecast(s) };
  }, [data]);

  const open = (e: MouseEvent) => requestExpandedMode(e.nativeEvent, 'game');
  const me = data?.me;
  const c = data?.community;
  const leader = c ? [...NATION_LIST].sort((a, b) => c.nations[b] - c.nations[a]).find((n) => c.nations[n] > 0) : undefined;
  const cta = !data
    ? 'Begin'
    : me?.solved
      ? me.ways.length < (c?.waysTotal ?? 0)
        ? 'Hunt another way'
        : 'See the hunt'
      : data.forge
        ? 'Take the trial'
        : data.isToday
          ? "Begin today's trial"
          : 'Play this trial';

  return (
    <div className="splash">
      <div className="sky" />
      <div className="splash-inner">
        <header className="splash-head">
          <Moon size={54} className="splash-moon" />
          <div>
            <div className="wordmark splash-word">Foefall</div>
            <div className="splash-sub">A daily tactics trial from the world of Orvandel</div>
          </div>
        </header>

        <div className="splash-mid">
          <button className="splash-board" onClick={open} aria-label="Open today's trial">
            {preview && data ? (
              <Board
                puzzle={data.puzzle}
                state={preview.s}
                strikes={preview.strikes}
                doomed={new Set()}
                danger={new Set()}
                selected={null}
                moveTiles={[]}
                targetTiles={[]}
                striking={false}
                label="Today's trial"
              />
            ) : (
              <div className="splash-board-empty">{err ? 'The moon is clouded over. Tap to try.' : ''}</div>
            )}
          </button>
          <div className="splash-info">
            {data && (
              <>
                {!data.forge && <div className="splash-date">{longDate(data.date)}</div>}
                <div className="display splash-day">{data.forge ? data.forge.title || 'A trial by a redditor' : `#${data.day} · ${data.moon}`}</div>
                <div className="splash-feel">{data.forge ? `Built by u/${data.forge.author} · ${data.feel}` : data.feel}</div>
                <p className="splash-rule">Every monster shows where it will strike. Make them strike each other.</p>
                <ul className="splash-stats">
                  {c && c.players > 0 ? (
                    <li>
                      <b>{c.solvers}</b> cleared of {c.players} who tried
                    </li>
                  ) : (
                    <li>Nobody has tried it yet. Be the first.</li>
                  )}
                  <li>
                    <b>
                      {c?.ways.length ?? 0}/{c?.waysTotal ?? 0}
                    </b>{' '}
                    {c && c.ways.length === 0 ? 'ways found. Every one is unclaimed.' : `ways found by r/${data.subreddit}`}
                  </li>
                  {c && leader && (
                    <li>
                      <b>{NATIONS[leader].sigil}</b> {NATIONS[leader].short} leads today with {c.nations[leader]}{' '}
                      {c.nations[leader] === 1 ? 'clear' : 'clears'}
                    </li>
                  )}
                  {me && me.streak > 0 && (
                    <li>
                      <b>{me.streak}</b> day streak
                    </li>
                  )}
                </ul>
              </>
            )}
          </div>
        </div>

        <button className="btn primary splash-cta" onClick={open}>
          {cta}
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
