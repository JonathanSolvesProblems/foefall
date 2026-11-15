import { useMemo, useState } from 'react';
import { checkForge, FORGE_LIMITS, FORGE_SIZE, type ForgeCheck, forgeShortfall } from '../../shared/forge';
import {
  CLASSES,
  type ClassId,
  type Dir,
  type Enemy,
  forecast,
  type Hero,
  initialState,
  type Lamp,
  MOBS,
  type MobId,
  outcomeOf,
  type Puzzle,
  resolveStrikes,
} from '../../shared/engine/rules';
import { Board } from './Board';
import { CLASS_ICON, IconBadge, Moon, MOB_ICON } from './art';

type Tool =
  | { kind: 'tile'; tile: '.' | '#' | '~'; label: string }
  | { kind: 'lamp'; label: string }
  | { kind: 'mob'; mob: MobId; label: string }
  | { kind: 'hero'; cls: ClassId; label: string }
  | { kind: 'erase'; label: string };

const TOOLS: Tool[] = [
  { kind: 'mob', mob: 'wolf', label: 'Wolf' },
  { kind: 'mob', mob: 'boar', label: 'Boar' },
  { kind: 'mob', mob: 'thief', label: 'Thief' },
  { kind: 'mob', mob: 'acolyte', label: 'Acolyte' },
  { kind: 'tile', tile: '#', label: 'Rock' },
  { kind: 'tile', tile: '~', label: 'Chasm' },
  { kind: 'lamp', label: 'Lamp' },
  { kind: 'hero', cls: 'vanguard', label: 'Vanguard' },
  { kind: 'hero', cls: 'reaver', label: 'Reaver' },
  { kind: 'hero', cls: 'gloamhunter', label: 'Hunter' },
  { kind: 'hero', cls: 'hexweaver', label: 'Hexweaver' },
  { kind: 'hero', cls: 'shardcaller', label: 'Shardcaller' },
  { kind: 'tile', tile: '.', label: 'Floor' },
  { kind: 'erase', label: 'Erase' },
];

const TURN: Record<Dir, Dir> = { N: 'E', E: 'S', S: 'W', W: 'N' };

export const EMPTY_FORGE: Puzzle = {
  id: 'forge',
  w: FORGE_SIZE,
  h: FORGE_SIZE,
  rows: Array.from({ length: FORGE_SIZE }, () => '.'.repeat(FORGE_SIZE)),
  heroes: [],
  enemies: [],
  lamps: [],
};

function renumber(p: Puzzle): Puzzle {
  return {
    ...p,
    heroes: p.heroes.map((h, i) => ({ ...h, id: `h${i + 1}` })),
    enemies: p.enemies.map((e, i) => ({ ...e, id: `e${i + 1}` })),
    lamps: p.lamps.map((l, i) => ({ ...l, id: `l${i + 1}` })),
  };
}

function setTile(rows: string[], x: number, y: number, c: string): string[] {
  return rows.map((r, j) => (j === y ? r.slice(0, x) + c + r.slice(x + 1) : r));
}

/** Apply one tap with a tool. Pure, so the editor can undo by keeping history. */
function applyTool(p: Puzzle, tool: Tool, x: number, y: number): Puzzle {
  const at = <T extends { x: number; y: number }>(v: T) => v.x === x && v.y === y;
  const without = { ...p, heroes: p.heroes.filter((h) => !at(h)), enemies: p.enemies.filter((e) => !at(e)), lamps: p.lamps.filter((l) => !at(l)) };
  const floor = (q: Puzzle) => ({ ...q, rows: setTile(q.rows, x, y, '.') });
  switch (tool.kind) {
    case 'tile':
      return renumber({ ...(tool.tile === '.' ? p : without), rows: setTile(p.rows, x, y, tool.tile) });
    case 'erase': {
      const hasPiece = without.heroes.length + without.enemies.length + without.lamps.length < p.heroes.length + p.enemies.length + p.lamps.length;
      return renumber(hasPiece ? without : floor(p));
    }
    case 'lamp': {
      if (p.lamps.some(at)) return renumber(without);
      if (p.lamps.length >= FORGE_LIMITS.lamps[1]) return p;
      const l: Lamp = { id: 'l', x, y, lit: true };
      return renumber(floor({ ...without, lamps: [...without.lamps, l] }));
    }
    case 'mob': {
      const here = p.enemies.find(at);
      if (here && here.mob === tool.mob) {
        return { ...p, enemies: p.enemies.map((e) => (e === here ? { ...e, dir: TURN[e.dir] } : e)) };
      }
      if (!here && p.enemies.length >= FORGE_LIMITS.enemies[1]) return p;
      const e: Enemy = { id: 'e', side: 'enemy', mob: tool.mob, x, y, hp: 1, dir: 'W' };
      return renumber(floor({ ...without, enemies: [...without.enemies, e] }));
    }
    case 'hero': {
      const here = p.heroes.find(at);
      if (here && here.cls === tool.cls) return renumber(without);
      const others = without.heroes.filter((h) => h.cls !== tool.cls);
      if (others.length >= FORGE_LIMITS.heroes[1]) return p;
      const h: Hero = { id: 'h', side: 'hero', cls: tool.cls, x, y, hp: 1 };
      return renumber(floor({ ...without, heroes: [...others, h] }));
    }
  }
}

export function ForgeEditor(props: { initial: Puzzle; onProve: (p: Puzzle, ways: number) => void; onExit: () => void; onChange: (p: Puzzle) => void }) {
  const [history, setHistory] = useState<Puzzle[]>([props.initial]);
  const [tool, setTool] = useState<Tool>(TOOLS[0]!);
  const [check, setCheck] = useState<ForgeCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const puzzle = history[history.length - 1]!;

  const view = useMemo(() => {
    const s = initialState(puzzle);
    const strikes = forecast(s);
    const end = resolveStrikes(s).state;
    const doomed = new Set(end.fallen.map((f) => f.id));
    const danger = new Set<string>([...end.lost.map((l) => l.id), ...end.lamps.filter((l) => !l.lit).map((l) => l.id)]);
    return { s, strikes, doomed, danger, idleWins: outcomeOf(end).win };
  }, [puzzle]);

  const update = (next: Puzzle) => {
    if (next === puzzle) return;
    setHistory((h) => [...h, next]);
    setCheck(null);
    props.onChange(next);
  };

  const runCheck = () => {
    setChecking(true);
    setCheck(null);
    // Let the "Checking" state paint before the solver blocks the thread.
    window.setTimeout(() => {
      setCheck(checkForge(puzzle));
      setChecking(false);
    }, 40);
  };

  const short = forgeShortfall(puzzle);
  let status: string;
  if (checking) status = 'Checking every move your heroes could make…';
  else if (check?.ok) status = `It can be won ${check.ways === 1 ? 'one way' : `${check.ways} ways`}. Now prove it: clear it yourself.`;
  else if (check) status = check.reason;
  else if (short) status = short;
  else if (view.idleWins) status = 'Right now every monster falls with nobody moving. Turn or move them so they miss.';
  else status = 'Tap Check to see whether it can be won.';

  const counts = `${puzzle.heroes.length}/${FORGE_LIMITS.heroes[1]} heroes · ${puzzle.enemies.length}/${FORGE_LIMITS.enemies[1]} monsters · ${puzzle.lamps.length}/${FORGE_LIMITS.lamps[1]} lamps`;

  return (
    <div className="game forge">
      <div className="topbar">
        <Moon size={38} />
        <div className="title">
          <div className="wordmark">Build a trial</div>
          <div className="sub">{counts}</div>
        </div>
        <button className="icon-btn" aria-label="Back to the trial" onClick={props.onExit}>
          ×
        </button>
      </div>

      <div className={`forecast${check?.ok ? ' perfect' : ''}`} aria-live="polite">
        <span className={check && !check.ok ? 'bad' : ''}>{status}</span>
      </div>

      <div className="board-slot">
        <div className="board-wrap forge-board">
          <Board
            puzzle={puzzle}
            state={view.s}
            strikes={view.strikes}
            doomed={view.doomed}
            danger={view.danger}
            selected={null}
            moveTiles={[]}
            targetTiles={[]}
            striking={false}
            onTile={(x, y) => update(applyTool(puzzle, tool, x, y))}
            label="Forge board"
          />
        </div>
      </div>

      <div className="palette" role="toolbar" aria-label="Pieces">
        {TOOLS.map((t) => {
          const active = t === tool;
          let icon;
          if (t.kind === 'mob') icon = <IconBadge name={MOB_ICON[t.mob]} ring="#d1543f" fill="#efe6d2" size={30} />;
          else if (t.kind === 'hero') icon = <IconBadge name={CLASS_ICON[t.cls]} ring="#d9b66b" fill="#f1d590" size={30} />;
          else if (t.kind === 'lamp') icon = <IconBadge name="lanternFlame" ring="#8d7240" fill="#ffd88a" size={30} />;
          else icon = <span className={`swatch swatch-${t.kind === 'erase' ? 'erase' : t.tile === '#' ? 'rock' : t.tile === '~' ? 'chasm' : 'floor'}`} />;
          const hint =
            t.kind === 'mob' ? `${MOBS[t.mob].name}. Tap it again to turn it.` : t.kind === 'hero' ? `${CLASSES[t.cls].name}: ${CLASSES[t.cls].ability}` : t.label;
          return (
            <button key={t.label} className={`tool${active ? ' active' : ''}`} title={hint} aria-pressed={active} onClick={() => setTool(t)}>
              {icon}
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="actions">
        <button
          className="btn"
          disabled={history.length < 2}
          onClick={() => {
            const prev = history[history.length - 2];
            if (!prev) return;
            setHistory((h) => h.slice(0, -1));
            setCheck(null);
            props.onChange(prev);
          }}
        >
          Undo
        </button>
        <button className="btn" disabled={checking || !!short} onClick={runCheck}>
          Check
        </button>
        <button className={`btn primary${check?.ok ? ' ready' : ''}`} disabled={!check?.ok} onClick={() => check?.ok && props.onProve(puzzle, check.ways)}>
          Prove it
        </button>
      </div>
    </div>
  );
}
